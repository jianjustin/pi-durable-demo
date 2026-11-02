import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { context, readHistory, sendMessage } from "./agent.ts";

export async function runTerminal(harness: Harness, conversation: Conversation, options: {
  input?: Readable;
  output?: Writable;
  prompt?: string;
} = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const terminal = input === process.stdin && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let lines: Interface | undefined;
  let stopping = false;
  let timedOut = false;
  let failed = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= harness.close(context);
  const stop = () => {
    stopping = true;
    lines?.close();
    void close().catch(() => {});
  };
  const reply = async (text: string) => {
    // Limit each request, not the time spent reading or typing in the session.
    const timeout = setTimeout(() => { timedOut = true; stop(); }, 120_000);
    timeout.unref();
    try {
      const result = await sendMessage(conversation, text);
      output.write(`助手 > ${result.answer}\n\n`);
    } finally {
      clearTimeout(timeout);
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    output.write(`\n会话 ${conversation.id}\n\n`);
    if (options.prompt) {
      await reply(options.prompt);
      return;
    }
    const history = await readHistory(conversation);
    if (history.length) {
      output.write("已恢复历史对话：\n\n");
      for (const message of history) {
        output.write(`${message.role === "user" ? "你" : "助手"} > ${message.text}\n\n`);
      }
    } else {
      output.write("还没有历史消息，开始聊天吧。\n\n");
    }
    if (stopping) return;
    output.write("输入消息后回车。输入 /exit 退出，下次启动会显示这些对话。\n\n");
    lines = createInterface({ input, output, terminal, crlfDelay: Infinity });
    lines.setPrompt("你 > ");
    lines.on("SIGINT", stop);
    if (terminal) lines.prompt();
    for await (const line of lines) {
      if (stopping) break;
      const text = line.trim();
      if (text === "/exit") break;
      if (text) {
        if (!terminal) output.write(`你 > ${text}\n`);
        output.write("助手正在回复…\n");
        await reply(text);
      }
      if (terminal && !stopping) lines.prompt();
    }
  } catch (error) {
    failed = timedOut || !stopping;
    if (timedOut) throw new Error("本轮回复等待超过两分钟，已退出。已存储的会话记录仍然保留。");
    if (!stopping) throw error;
  } finally {
    lines?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await close();
    if (!failed) output.write("已退出会话。再次运行 npm start 即可回到这里。\n");
  }
}
