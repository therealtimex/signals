import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Personality cross-process store lock", () => {
  it("permits one generation commit while a competing process fails busy", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "signals-378-process-"));
    roots.push(dataDir);
    const runner = resolve(process.cwd(), "node_modules/.bin/vite-node");
    const child = resolve(process.cwd(), "src/test/personality-projection-child.ts");
    const env = { ...process.env, SIGNALS_DATA_DIR: dataDir };
    const holder = spawn(runner, ["--config", "vitest.config.ts", child, "hold"], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let holderStderr = "";
    holder.stderr.on("data", (chunk) => {
      holderStderr += String(chunk);
    });
    const holderExitPromise = new Promise<number | null>((resolveExit, reject) => {
      holder.once("exit", resolveExit);
      holder.once("error", reject);
    });
    await new Promise<void>((resolveLocked, reject) => {
      const timeout = setTimeout(() => reject(new Error("holder did not acquire lock")), 5_000);
      holder.stdout.on("data", (chunk) => {
        if (String(chunk).includes("locked")) {
          clearTimeout(timeout);
          resolveLocked();
        }
      });
      holder.once("error", reject);
      holder.once("exit", (code) => {
        if (code !== 0) reject(new Error(`holder exited before locking (${code})`));
      });
    });
    const contender = await execFileAsync(runner, ["--config", "vitest.config.ts", child, "contend"], {
      cwd: process.cwd(),
      env,
    });
    expect(contender.stdout.trim()).toBe("STORE_BUSY");
    const holderExit = await holderExitPromise;
    expect(holderExit, holderStderr).toBe(0);
    const inspected = await execFileAsync(runner, ["--config", "vitest.config.ts", child, "inspect"], {
      cwd: process.cwd(),
      env,
    });
    expect(inspected.stdout.trim()).toBe("1");
  }, 15_000);
});
