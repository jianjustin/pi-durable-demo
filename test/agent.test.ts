import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Readable, Writable } from "node:stream";
import { contentText, createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { context, openAgent, readHistory, sendMessage } from "../src/agent.ts";
import { createSubscriptionModels } from "../src/auth.ts";
import { runTerminal } from "../src/terminal.ts";
import { chooseConversation, listSavedConversations } from "../src/sessions.ts";
import { openExclusiveStorage } from "../src/storage.ts";

test("同一数据库拒绝其他进程和符号链接重复打开，关闭后可重新进入", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-lock-"));
  const dbPath = join(dir, "session.sqlite");
  const alias = join(dir, "alias.sqlite");
  const storage = await openExclusiveStorage(dbPath);
  try {
    await symlink(dbPath, alias);
    const program = `
      import { openExclusiveStorage } from ${JSON.stringify(new URL("../src/storage.ts", import.meta.url).href)};
      import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
      try {
        const storage = await openExclusiveStorage(process.argv[1]);
        await storage.close(BACKGROUND_CONTEXT);
      } catch (error) { console.error(error.message); process.exitCode = 2; }
    `;
    for (const path of [dbPath, alias]) {
      await assert.rejects(promisify(execFile)(process.execPath, ["--input-type=module", "-e", program, path]),
        (error: unknown) => error instanceof Error && "stderr" in error && /另一个窗口打开/.test(String(error.stderr)));
    }
  } finally {
    await storage.close(context);
  }
  try {
    const reopened = await openExclusiveStorage(alias);
    await reopened.close(context);
    await reopened.close(context);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SQLite 重开后保留同一会话、历史上下文，并去重相同 requestId", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-test-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  try {
    faux.setResponses([fauxAssistantMessage("记住了：蓝鲸。")]);
    const first = await openAgent(dbPath, models, model.id, model.provider);
    let firstResult;
    try {
      firstResult = await sendMessage(first.conversation, "口令是蓝鲸。", "message-1");
      assert.equal(firstResult.answer, "记住了：蓝鲸。");
    } finally {
      await first.harness.close(context);
    }

    faux.setResponses([(transcript) => {
      const history = transcript.messages.map(message => contentText(message.content)).join("\n");
      assert.match(history, /口令是蓝鲸/);
      assert.match(history, /记住了：蓝鲸/);
      return fauxAssistantMessage("蓝鲸");
    }]);
    const second = await openAgent(dbPath, models, model.id, model.provider);
    try {
      assert.equal(second.conversation.id, firstResult.conversationId);
      const replay = await sendMessage(second.conversation, "口令是蓝鲸。", "message-1");
      assert.equal(replay.submissionId, firstResult.submissionId);
      assert.equal(faux.state.callCount, 1);
      assert.equal((await sendMessage(second.conversation, "口令是什么？", "message-2")).answer, "蓝鲸");
      assert.equal(faux.state.callCount, 2);
    } finally {
      await second.harness.close(context);
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM conversations").get()?.n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = 'done'").get()?.n, 2);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entries WHERE json_extract(record, '$.kind') IN ('pi.user', 'pi.assistant')").get()?.n, 4);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("可以新开独立会话，并按编号恢复指定会话", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-sessions-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  try {
    const first = await openAgent(dbPath, models, model.id, model.provider, { kind: "new" });
    const firstId = first.conversation.id;
    await first.harness.close(context);
    const second = await openAgent(dbPath, models, model.id, model.provider, { kind: "new" });
    const secondId = second.conversation.id;
    await second.harness.close(context);
    assert.notEqual(firstId, secondId);

    const saved = listSavedConversations(dbPath);
    assert.deepEqual(saved.map((item) => item.id), [firstId, secondId]);
    let output = "";
    const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    async function* selections() {
      yield "2\n";
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield "2\n";
    }
    const choice = await chooseConversation(saved, { input: Readable.from(selections()), output: stream });
    assert.deepEqual(choice, { kind: "existing", conversationId: secondId });
    assert.match(output, new RegExp(`会话 ${firstId}`));
    const restored = await openAgent(dbPath, models, model.id, model.provider, choice);
    try {
      assert.equal(restored.conversation.id, secondId);
    } finally {
      await restored.harness.close(context);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("模型可以调用无副作用的当前时间工具，并得到工具结果后继续回答", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-tool-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  try {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("get_current_time", { timeZone: "Asia/Shanghai" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("现在是上海时间。"),
    ]);
    const agent = await openAgent(dbPath, models, model.id, model.provider, { kind: "new" }, {
      onToolStart: (name, args) => calls.push({ name, args }),
    });
    try {
      const result = await sendMessage(agent.conversation, "现在几点？");
      assert.equal(result.answer, "现在是上海时间。");
      assert.equal(faux.state.callCount, 2, "工具结果应触发模型继续回答");
      assert.deepEqual(calls, [{ name: "get_current_time", args: { timeZone: "Asia/Shanghai" } }]);
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(record, '$.kind') = 'pi.tool'").get()?.n, 1);
      } finally {
        db.close();
      }
    } finally {
      await agent.harness.close(context);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("项目 Skill 会作为持久化会话的系统提示加载", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-skills-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  let requestTranscript = "";
  try {
    faux.setResponses([(transcript) => {
      requestTranscript = JSON.stringify(transcript.messages);
      return fauxAssistantMessage("Skill 已加载。 ");
    }]);
    const agent = await openAgent(dbPath, models, model.id, model.provider, { kind: "new" });
    try {
      assert.equal((await sendMessage(agent.conversation, "请确认你的能力。")).answer, "Skill 已加载。 ");
      assert.match(requestTranscript, /<skill name=\\"time-awareness\\">/);
      assert.match(requestTranscript, /call `get_current_time` before answering/);
    } finally {
      await agent.harness.close(context);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("缺少 OAuth 或只有 API key 时拒绝运行，不切换计费方式", async () => {
  const credentials = new InMemoryCredentialStore();
  await assert.rejects(createSubscriptionModels({ credentials }), /ChatGPT 订阅登录/);
  await credentials.modify("openai", async () => ({ type: "api_key", key: "test-only-not-a-real-key" }));
  await assert.rejects(createSubscriptionModels({ credentials }), /ChatGPT 订阅登录/);
});

test("交互会话聊两轮、/exit 退出、重新进入显示两轮且不新增请求", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-chat-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  let transcript = "";
  const output = new Writable({ write(chunk, _encoding, callback) { transcript += chunk.toString(); callback(); } });
  try {
    faux.setResponses([fauxAssistantMessage("你好！"), fauxAssistantMessage("记住了：青色。")]);
    const first = await openAgent(dbPath, models, model.id, model.provider);
    await runTerminal(first.harness, first.conversation, {
      input: Readable.from(["你好\n\n请记住青色\n/exit\n这句不能被发送\n"]), output,
    });
    assert.equal(faux.state.callCount, 2);
    assert.match(transcript, /已退出会话/);

    transcript = "";
    const second = await openAgent(dbPath, models, model.id, model.provider);
    assert.equal(second.conversation.id, first.conversation.id);
    await runTerminal(second.harness, second.conversation, { input: Readable.from(["/exit\n"]), output });
    assert.match(transcript, /已恢复历史对话/);
    assert.match(transcript, /你 > 你好\n\n助手 > 你好！\n\n你 > 请记住青色\n\n助手 > 记住了：青色。/);
    assert.equal(faux.state.callCount, 2, "只看历史不得调用模型");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM submissions").get()?.n, 2);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("回复中断时不显示正常退出提示，重开后标明未完成并可继续聊天", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-durable-interrupted-"));
  const dbPath = join(dir, "session.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  let transcript = "";
  const output = new Writable({ write(chunk, _encoding, callback) { transcript += chunk.toString(); callback(); } });
  try {
    faux.setResponses([fauxAssistantMessage("尚未写完的回复", { stopReason: "aborted" })]);
    const first = await openAgent(dbPath, models, model.id, model.provider);
    await assert.rejects(runTerminal(first.harness, first.conversation, { prompt: "写一篇长文", output }), /模型未完成回复|未得到有效的模型回复/);
    assert.doesNotMatch(transcript, /已退出会话/);

    const second = await openAgent(dbPath, models, model.id, model.provider);
    try {
      const history = await readHistory(second.conversation);
      assert.match(history.map(message => message.text).join("\n"), /尚未写完的回复\n（这条回复已中断/);
      faux.setResponses([fauxAssistantMessage("可以继续聊天。")]);
      assert.equal((await sendMessage(second.conversation, "现在能聊天吗？")).answer, "可以继续聊天。");
    } finally {
      await second.harness.close(context);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
