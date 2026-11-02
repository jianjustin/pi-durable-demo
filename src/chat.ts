import { createSubscriptionModels } from "./auth.ts";
import { openAgent } from "./agent.ts";
import { authPath, dbPath, modelId } from "./config.ts";
import { runTerminal } from "./terminal.ts";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  const models = await createSubscriptionModels({ authPath });
  // Validate/refresh the login before admitting a new message to SQLite.
  const auth = await models.getAuth("openai", { signal: AbortSignal.timeout(30_000) });
  if (!auth) throw new Error("ChatGPT 登录不可用，请在 Pi 中重新登录。");
  const { harness, conversation } = await openAgent(dbPath, models, modelId);
  console.log(`ChatGPT 订阅 · ${modelId}`);
  await runTerminal(harness, conversation, { prompt });
}

main().catch((error: unknown) => {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
