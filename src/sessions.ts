import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { ConversationChoice } from "./agent.ts";
import type { Conversation } from "@earendil-works/pi-durable";

export type SavedConversation = { id: Conversation["id"]; messageCount: number };

export function listSavedConversations(path: string): SavedConversation[] {
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(`
      SELECT c.id AS id, COUNT(e.id) AS messageCount
      FROM conversations c
      LEFT JOIN entries e ON e.conversation_id = c.id
        AND json_extract(e.record, '$.kind') IN ('pi.user', 'pi.assistant')
      GROUP BY c.id
      ORDER BY c.id ASC
    `).all().map((row) => ({ id: Number(row.id) as Conversation["id"], messageCount: Number(row.messageCount) }));
  } finally {
    db.close();
  }
}

export async function chooseConversation(
  saved: SavedConversation[],
  options: { input?: Readable; output?: Writable } = {},
): Promise<ConversationChoice> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const terminal = input === process.stdin && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const lines = createInterface({ input, output, terminal });
  try {
    if (saved.length === 0) {
      output.write("还没有可恢复的会话，将新开一个会话。\n\n");
      return { kind: "new" };
    }
    while (true) {
      const action = (await lines.question("请选择：1) 新开会话  2) 恢复已有会话\n> ")).trim();
      if (action === "1") return { kind: "new" };
      if (action !== "2") {
        output.write("请输入 1 或 2。\n");
        continue;
      }
      output.write("\n已有会话：\n");
      saved.forEach((conversation, index) => {
        output.write(`${index + 1}) 会话 ${conversation.id}（${conversation.messageCount} 条消息）\n`);
      });
      const selected = Number((await lines.question("输入要恢复的会话编号：")).trim());
      if (Number.isInteger(selected) && selected >= 1 && selected <= saved.length) {
        return { kind: "existing", conversationId: saved[selected - 1].id };
      }
      output.write("编号无效，请重新选择。\n\n");
    }
  } finally {
    lines.close();
  }
}
