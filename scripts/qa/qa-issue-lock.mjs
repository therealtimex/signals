import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

// A lock file whose JSON cannot be read is assumed held for this long. link() publishes locks
// whole, so unreadable content means corruption, not a writer caught mid-write.
const UNREADABLE_GRACE_MS = 30_000;

const BUSY_MESSAGES = {
  held: (path, holder) => `qa-local-app ${holder.action || "run"} (pid ${holder.pid}) holds ${path}.`,
  unreadable: (path) =>
    `${path} has no valid holder record and is under ${UNREADABLE_GRACE_MS / 1000} s old, so it counts as held.`,
  contended: (path) =>
    `${path} kept changing hands while this run tried to take it; another qa-local-app run is contending for it.`,
};

export class IssueLockBusyError extends Error {
  constructor(path, holder, reason) {
    super(BUSY_MESSAGES[reason](path, holder));
    this.path = path;
    this.holder = holder;
    this.reason = reason;
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
  // Only a record naming a real pid is a holder. Anything else, `{}` included, is treated like
  // unreadable content and gets the grace period rather than an immediate takeover.
  let holder = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isInteger(parsed.pid) && parsed.pid > 0) holder = parsed;
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
// over. afterTakeover lets tests stand in for a contender.
export function acquireIssueLock(path, action, { maxTakeovers = 5, afterTakeover } = {}) {
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
    // A link attempt follows every takeover, the last one included, so only a lock that keeps
    // changing hands exhausts the rounds.
    for (let round = 0; ; round += 1) {
      try {
        linkSync(draft, path);
        return () => releaseIssueLock(path, nonce);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (round === maxTakeovers) throw new IssueLockBusyError(path, null, "contended");
      const observed = readLock(path);
      if (!observed) continue;
      if (observed.holder ? lockHolderAlive(observed.holder) : observed.ageMs < UNREADABLE_GRACE_MS) {
        throw new IssueLockBusyError(
          path,
          observed.holder,
          observed.holder ? "held" : "unreadable",
        );
      }
      takeOverStaleLock(path, observed.raw);
      afterTakeover?.();
    }
  } finally {
    rmSync(draft, { force: true });
  }
}
