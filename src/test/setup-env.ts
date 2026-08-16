import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Isolate SQLite per Vitest worker when CI pins a shared SIGNALS_DATA_DIR. */
function initTestDataDir(): string {
  const sharedBase = process.env.SIGNALS_DATA_DIR?.replace(/^~/, homedir());
  const workerId = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID;

  if (sharedBase && workerId !== undefined) {
    const dir = join(sharedBase, `worker-${workerId}`);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  if (sharedBase) {
    return sharedBase;
  }

  return mkdtempSync(join(tmpdir(), "signals-vitest-"));
}

process.env.SIGNALS_DATA_DIR = initTestDataDir();
