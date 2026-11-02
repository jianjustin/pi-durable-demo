import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { contentText } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { dbPath } from "./config.ts";

try {
  if (!existsSync(dbPath)) throw new Error("还没有会话数据库，请先运行 npm start。");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    console.log(`SQLite: ${dbPath}`);
    console.table(db.prepare(`
      SELECT 'conversations' AS name, COUNT(*) AS count FROM conversations
      UNION ALL SELECT 'entries', COUNT(*) FROM entries
      UNION ALL SELECT 'submissions', COUNT(*) FROM submissions
      UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
    `).all());
    console.table(db.prepare("SELECT id, conversation_id, status FROM submissions ORDER BY id").all());
    for (const row of db.prepare("SELECT record FROM entries ORDER BY id").all()) {
      const entry = JSON.parse(String(row.record)) as EntryRecord;
      for (const message of entry.model ?? []) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        console.log(`\n[${entry.id}] ${message.role === "user" ? "用户" : "助手"}`);
        console.log(contentText(message.content));
        if (message.role === "assistant" && message.errorMessage) console.log(`错误: ${message.errorMessage}`);
      }
    }
  } finally {
    db.close();
  }
} catch (error) {
  console.error(`检查失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
