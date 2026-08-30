import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import { AgentToolError } from "@/lib/agent-tools/types";
import { canonicalJson, sha256Canonical } from "@/lib/writing/hash";

type LockOwner = {
  pid: number;
  hostname: string;
  token: string;
  acquiredAt: number;
};

export type FileLockOptions = {
  timeoutMs?: number;
  busyMessage?: string;
};

export type JsonWriteOptions = {
  beforeWrite?: (path: string) => void;
  afterWrite?: (path: string) => void;
};

export type CommitIndexOptions = JsonWriteOptions & {
  path: string;
  conflictMessage?: string;
};

const mutexes = new Map<string, Promise<void>>();

export function ensureStoreDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return realpathSync(path);
}

export function resetStoreDirectory(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function acquireFileLock(
  dir: string,
  options: FileLockOptions = {},
): Promise<() => void> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ".store.lock");
  const owner: LockOwner = {
    pid: process.pid,
    hostname: hostname(),
    token: nanoid(),
    acquiredAt: Math.floor(Date.now() / 1000),
  };
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  let delay = 25;
  let observedOwner: Partial<LockOwner> | undefined;

  while (Date.now() < deadline) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, canonicalJson(owner));
      fsyncSync(fd);
      closeSync(fd);
      return () => {
        try {
          const current = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
          if (current.token === owner.token) unlinkSync(path);
        } catch {
          // Another recovery path already removed it.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const current = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
        observedOwner = current;
        if (
          current.hostname === hostname()
          && Number.isInteger(current.pid)
          && !processAlive(current.pid!)
        ) {
          unlinkSync(path);
          continue;
        }
      } catch {
        // An unreadable lock cannot be proven stale.
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await wait(Math.min(delay, remaining));
      delay = Math.min(250, delay * 2);
    }
  }

  throw new AgentToolError("STORE_BUSY", options.busyMessage ?? "Store is busy", {
    ...(observedOwner
      ? {
          owner: {
            pid: observedOwner.pid,
            hostname: observedOwner.hostname,
            acquiredAt: observedOwner.acquiredAt,
          },
        }
      : {}),
  });
}

export async function withStoreLock<T>(
  dir: string,
  mutexKey: string,
  operation: () => Promise<T> | T,
  options: FileLockOptions = {},
): Promise<T> {
  const previous = mutexes.get(mutexKey) ?? Promise.resolve();
  let releaseMutex!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  const tail = previous.then(() => current);
  mutexes.set(mutexKey, tail);
  await previous;
  let releaseFile: (() => void) | undefined;
  try {
    releaseFile = await acquireFileLock(dir, options);
    return await operation();
  } finally {
    releaseFile?.();
    releaseMutex();
    if (mutexes.get(mutexKey) === tail) mutexes.delete(mutexKey);
  }
}

export function fsyncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeJsonTemp(path: string, value: unknown): string {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${nanoid()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, `${canonicalJson(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temp;
}

export function installImmutable(
  path: string,
  value: unknown,
  options: JsonWriteOptions = {},
): void {
  options.beforeWrite?.(path);
  const temp = writeJsonTemp(path, value);
  try {
    linkSync(temp, path);
  } finally {
    unlinkSync(temp);
  }
  fsyncDirectory(dirname(path));
  options.afterWrite?.(path);
}

export function atomicReplaceJson(
  path: string,
  value: unknown,
  options: JsonWriteOptions = {},
): void {
  options.beforeWrite?.(path);
  const temp = writeJsonTemp(path, value);
  try {
    renameSync(temp, path);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  fsyncDirectory(dirname(path));
  options.afterWrite?.(path);
}

export function commitIndex<T extends { generation: number }>(
  readCurrent: () => T,
  base: T,
  next: T,
  options: CommitIndexOptions,
): void {
  const current = readCurrent();
  if (
    current.generation !== base.generation
    || sha256Canonical(current) !== sha256Canonical(base)
  ) {
    throw new AgentToolError(
      "STORE_CONFLICT",
      options.conflictMessage ?? "Store index changed during commit",
    );
  }
  atomicReplaceJson(options.path, next, options);
}
