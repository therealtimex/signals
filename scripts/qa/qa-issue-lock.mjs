import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

// A lock file whose JSON cannot be read is assumed held for this long. link() publishes locks
// whole, so unreadable content means corruption, not a writer caught mid-write.
const UNREADABLE_GRACE_MS = 30_000;

export class IssueLockBusyError extends Error {
  constructor(path, holder) {
    super(
      holder
        ? `qa-local-app ${holder.action || "run"} (pid ${holder.pid}) holds ${path}.`
        : `${path} is held but unreadable.`,
    );
    this.path = path;
    this.holder = holder;
  }
}

export function pidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function processStartTime(pid) {
  const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

// A pid can be recycled by an unrelated process, so a recorded start time pins the identity.
// When ps is unavailable the pid alone decides, erring towards "held".
export function lockHolderAlive(holder) {
  if (!pidAlive(holder?.pid)) return false;
  if (!holder.pidStart) return true;
  const start = processStartTime(holder.pid);
  return start === null || start === holder.pidStart;
}

function readLock(path) {
  let raw;
  let ageMs;
  try {
    raw = readFileSync(path, "utf8");
    ageMs = Date.now() - statSync(path).mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let holder = null;
  try {
    holder = JSON.parse(raw);
  } catch {
    holder = null;
  }
  return { raw, holder, ageMs };
}

// Takeover removes only the stale lock this process inspected. rename() is atomic, so one
// contender moves a given file away; if what it moved is not the inspected content, another
// contender has already put a fresh lock there, and it goes back. If a third contender linked
// its own lock in that instant, theirs stays; release() is nonce-checked, so nobody deletes it.
export function takeOverStaleLock(path, staleRaw, tag = randomUUID()) {
  const grave = `${path}.${tag}.stale`;
  try {
    renameSync(path, grave);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  let moved = "";
  try {
    moved = readFileSync(grave, "utf8");
  } catch {
    moved = "";
  }
  if (moved !== staleRaw) {
    try {
      linkSync(grave, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  rmSync(grave, { force: true });
}

export function releaseIssueLock(path, nonce) {
  try {
    if (JSON.parse(readFileSync(path, "utf8")).nonce === nonce) rmSync(path, { force: true });
  } catch {
    // Gone or unreadable: nothing of ours to release.
  }
}

// Publishes {pid, pidStart, action, nonce} at path and returns its release function. The lock is
// written to a private file and hard-linked into place: link() fails when the path exists, and a
// visible lock is always complete. A live holder raises IssueLockBusyError; a stale one is taken
// over.
export function acquireIssueLock(path, action) {
  const nonce = randomUUID();
  const draft = `${path}.${nonce}.draft`;
  writeFileSync(
    draft,
    JSON.stringify({
      pid: process.pid,
      pidStart: processStartTime(process.pid),
      action,
      startedAt: Date.now(),
      nonce,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        linkSync(draft, path);
        return () => releaseIssueLock(path, nonce);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const observed = readLock(path);
      if (!observed) continue;
      const held = observed.holder
        ? lockHolderAlive(observed.holder)
        : observed.ageMs < UNREADABLE_GRACE_MS;
      if (held) throw new IssueLockBusyError(path, observed.holder);
      takeOverStaleLock(path, observed.raw);
    }
    throw new IssueLockBusyError(path, null);
  } finally {
    rmSync(draft, { force: true });
  }
}
