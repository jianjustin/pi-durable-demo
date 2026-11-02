import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

// Pi Durable requires one owner for the entire session, not just each SQLite write.
export async function openExclusiveStorage(dbPath: string) {
  const absolute = resolve(dbPath);
  await mkdir(dirname(absolute), { recursive: true });
  const canonical = await realpath(absolute).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return join(await realpath(dirname(absolute)), basename(absolute));
  });
  const release = await lockfile.lock(canonical, { realpath: false, retries: 0, stale: 30_000 })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ELOCKED") {
        throw new Error("这个会话已在另一个窗口打开。请先在那里输入 /exit，再重新运行 npm start；若刚强制结束程序，请等 30 秒后重试。");
      }
      throw error;
    });
  try {
    const storage = await openNodeSqliteStorage(canonical);
    const closeStorage = storage.close.bind(storage);
    let closing: Promise<void> | undefined;
    storage.close = (context) => closing ??= (async () => {
      // Release only after SQLite is closed, including when Harness.open fails.
      await closeStorage(context);
      await release();
    })();
    return storage;
  } catch (error) {
    await release();
    throw error;
  }
}
