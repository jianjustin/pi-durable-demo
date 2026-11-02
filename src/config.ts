import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectDir = fileURLToPath(new URL("../", import.meta.url));
export const dbPath = resolve(projectDir, process.env.PI_DB_PATH || "data/session.sqlite");
export const authPath = process.env.PI_AUTH_FILE
  ? resolve(projectDir, process.env.PI_AUTH_FILE.replace(/^~\//, `${homedir()}/`))
  : join(homedir(), ".pi", "agent", "auth.json");
export const modelId = process.env.PI_MODEL || "gpt-6.1-sol";
