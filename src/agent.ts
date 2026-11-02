import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText, type Models } from "@earendil-works/pi-ai";
import { AssistantEntry, createRegistry, Harness, type Conversation, type Cursor } from "@earendil-works/pi-durable";
import { openExclusiveStorage } from "./storage.ts";

export const context = BACKGROUND_CONTEXT;

export async function readHistory(conversation: Conversation) {
  const history: { role: "user" | "assistant"; text: string }[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({ order: "ascending" }, 100, cursor, context);
    for (const entry of page.items) {
      for (const message of entry.model ?? []) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        const text = contentText(message.content);
        if (text.trim()) history.push({ role: message.role, text });
        if (message.role === "assistant" && message.errorMessage) {
          history.push({ role: "assistant", text: `（这次回复未完成：${message.errorMessage}）` });
        } else if (message.role === "assistant" && message.stopReason === "aborted") {
          history.push({ role: "assistant", text: "（这条回复已中断，以上是已保存的部分。）" });
        }
      }
    }
    cursor = page.next;
  } while (cursor);
  return history;
}

export async function openAgent(dbPath: string, models: Models, modelId: string, provider = "openai") {
  if (!models.getModel(provider, modelId)) {
    throw new Error(`模型不在当前 Pi 版本的目录中：${provider}/${modelId}`);
  }
  const storage = await openExclusiveStorage(dbPath);
  let harness: Harness | undefined;
  try {
    harness = await Harness.open(storage, {
      models,
      registry: createRegistry(),
      settings: { retry: { maxRetries: 1 } },
    }, context);
    const conversation = await harness.root(context);
    await conversation.configure({
      model: { provider, modelId },
      thinkingLevel: "low",
      instructions: "你是一个简洁、准确的中文助手。根据已有对话回答；没有工具时，不声称已经执行外部操作。",
      tools: [],
    }, context);
    return { harness, conversation };
  } catch (error) {
    if (harness) await harness.close(context);
    else await storage.close(context);
    throw error;
  }
}

export async function sendMessage(conversation: Conversation, text: string, requestId?: string) {
  if (!text.trim()) throw new Error("消息不能为空。");
  const submission = await conversation.submit({ type: "input", content: text, requestId }, context);
  const settled = await submission.wait(context);
  if (settled.status !== "done" || settled.type !== "input") {
    throw new Error(`模型未完成回复：${settled.status}${settled.status === "unanswered" ? ` (${settled.reason})` : ""}`);
  }
  const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
  const message = entry?.model?.[0];
  if (message?.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error("未得到有效的模型回复，请用 npm run inspect 检查会话状态。");
  }
  const answer = contentText(message.content);
  if (!answer.trim()) throw new Error("模型返回了空文本。");
  return { answer, conversationId: conversation.id, submissionId: submission.id, model: message.model };
}
