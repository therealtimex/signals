import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireFileLock,
  atomicReplaceJson,
  commitIndex,
  installImmutable,
  withStoreLock,
} from "@/lib/store/locked-json-store";

const roots: string[] = [];

function testDir(): string {
  const root = mkdtempSync(join(tmpdir(), "signals-locked-store-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("locked JSON store", () => {
  it("reclaims a stale same-host process lock", async () => {
    const dir = testDir();
    writeFileSync(join(dir, ".store.lock"), JSON.stringify({
      pid: 2_147_483_647,
      hostname: hostname(),
      token: "dead",
      acquiredAt: 1,
    }));

    const release = await acquireFileLock(dir, { timeoutMs: 100 });
    release();
    await expect(withStoreLock(dir, dir, () => "ok", { timeoutMs: 100 })).resolves.toBe("ok");
  });

  it("returns STORE_BUSY after a bounded wait", async () => {
    const dir = testDir();
    writeFileSync(join(dir, ".store.lock"), JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      token: "held",
      acquiredAt: 1,
    }));

    await expect(acquireFileLock(dir, { timeoutMs: 30 })).rejects.toMatchObject({
      code: "STORE_BUSY",
      details: { owner: { pid: process.pid } },
    });
  });

  it("refuses an immutable install collision", () => {
    const dir = testDir();
    const path = join(dir, "documents", "one.json");
    installImmutable(path, { value: 1 });

    expect(() => installImmutable(path, { value: 2 })).toThrow();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ value: 1 });
  });

  it("atomically replaces JSON and rejects a stale generation commit", () => {
    const dir = testDir();
    mkdirSync(join(dir, "index"));
    const path = join(dir, "index", "index.json");
    const base = { generation: 0, values: ["base"] };
    let current = base;
    atomicReplaceJson(path, base);

    commitIndex(() => current, base, { generation: 1, values: ["next"] }, { path });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ generation: 1, values: ["next"] });

    current = { generation: 1, values: ["other"] };
    expect(() => commitIndex(
      () => current,
      base,
      { generation: 1, values: ["stale"] },
      { path },
    )).toThrow(expect.objectContaining({ code: "STORE_CONFLICT" }));
  });
});
