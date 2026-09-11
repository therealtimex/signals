#!/usr/bin/env node
/**
 * One deterministic entry point for a Signals QA Local App (AGENTS.md §10).
 *
 *   up      preflight -> canonical snapshot -> guarded provision -> wait until /api/health answers
 *   status  where the issue's QA app is and whether it answers
 *   down    guarded cleanup -> hygiene gate -> canonical diff -> port released
 *
 * provision-/cleanup-signals-qa-local-app.mjs still do the provisioning and deletion; this script
 * sequences them and adds the checks agents used to run by hand. It prints one JSON object on
 * stdout and exits 0 only when that object has `ok: true`. Every failure carries `errorCode` and
 * `next`, the command or action that resolves it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IssueLockBusyError, acquireIssueLock as acquireLockFile, pidAlive } from "./qa-issue-lock.mjs";
import {
  CANONICAL_SIGNALS_APP_ID,
  appsFromCliPayload,
  assertSafeQaApp,
  assertSignalsIssueWorktree,
  canonicalSignalsRepoRoot,
  findIssueQaApps,
  normalizeIssueId,
  parseFlagArgs,
  qaAppDisplayName,
  qaReceiptPath,
  qaTemporaryRoot,
  realtimexDbPath,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = join(SCRIPT_DIR, "qa-local-app.mjs");

const HOSTS = {
  packaged: {
    name: "packaged",
    baseUrl: "http://127.0.0.1:3001/cli",
    storageRoot: "app",
    runtime: "app",
  },
  dev: { name: "dev", baseUrl: "http://127.0.0.1:3101/cli", storageRoot: "dev", runtime: "dev" },
};
const LIST_ARGS = ["list-local-apps", "--data-source", "live", "--no-cache"];
const DEFAULT_TIMEOUT_MS = 240_000;
const STOPPED_GRACE_MS = 15_000;
const PORT_RELEASE_MS = 20_000;
// RealTimeX holds its permission dialog open for 120 s; allow a little beyond that.
const PERMISSION_WAIT_MS = 150_000;
const FAILED_STATUSES = new Set(["error", "crashed", "failed"]);

class QaError extends Error {
  constructor(errorCode, message, extra = {}) {
    super(message);
    this.errorCode = errorCode;
    this.extra = extra;
  }
}

function usage() {
  return `Usage:
  node scripts/qa/qa-local-app.mjs up --issue <N> [--worktree <path>] [--loop-id <id>] \\
    [--workspace-slug signals-issue-<N>-<suffix>] [--host packaged|dev] [--timeout-ms 240000] \\
    [--needs llm.chat,desktop.runtime-sessions]
  node scripts/qa/qa-local-app.mjs status --issue <N>
  node scripts/qa/qa-local-app.mjs down --issue <N> [--keep-data]

up      Provisions "Signals issue-<N> QA" for the worktree (default: the current directory) and
        waits until it answers /api/health. Rerunning it for the same worktree reuses the app.
        It prints the app's RealTimeX permissions: granted, denied, and pending.
        --needs waits for the user to grant the named permissions in RealTimeX's dialog and
        fails with PERMISSIONS_MISSING if any is not granted. Agents cannot grant them.
status  Reports whether the issue's QA app exists, runs, answers, and what it may do.
down    Deletes the QA app, runs the hygiene gate, diffs the canonical Signals record against the
        snapshot taken by up, and checks the QA port was released.

--host defaults to packaged (http://127.0.0.1:3001/cli). status and down follow the host up used.
--cli <path> replaces realtimex-pp-cli, e.g. a wrapper that adds --credential-ref for the dev host.
        up records it, so status and down reuse it.
--db <path> overrides the RealTimeX database read for the snapshot and the hygiene gate. Without
        it, RTX_DB_PATH applies, then the host default. down uses the database up recorded.
One up or down runs per issue at a time.

Prints one JSON object. Exit 0 only when ok is true; failures carry errorCode and next.`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function qaSessionPath(issueId) {
  return join(qaTemporaryRoot(), `signals-qa-local-app-issue-${issueId}.session.json`);
}

function writeSession(path, session) {
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function shellQuote(value) {
  const text = String(value);
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

// Recovery commands repeat everything that decided what the failing run touched: the host, the
// CLI (the dev host's default CLI cannot authenticate), the database, and --keep-data, whose
// absence on a rerun would delete the data the first run preserved.
function followUp(action, issueId, { host, cli = "", db = "", keepData = false, needs = [] }) {
  return [
    "node",
    shellQuote(SELF),
    action,
    "--issue",
    issueId,
    "--host",
    host,
    ...(cli ? ["--cli", shellQuote(cli)] : []),
    ...(db ? ["--db", shellQuote(db)] : []),
    ...(keepData ? ["--keep-data"] : []),
    ...(needs.length ? ["--needs", needs.join(",")] : []),
  ].join(" ");
}

// The permissions this Signals build asks RealTimeX for, from the worktree's rtx-manifest.json.
function requestedPermissions(worktree) {
  try {
    const manifest = JSON.parse(readFileSync(join(worktree, "rtx-manifest.json"), "utf8"));
    return Array.isArray(manifest.permissions) ? manifest.permissions : [];
  } catch {
    return [];
  }
}

function parseNeeds(flags, worktree) {
  const needs = [
    ...new Set(
      String(flags.get("needs") || "")
        .split(",")
        .map((permission) => permission.trim())
        .filter(Boolean),
    ),
  ];
  const requested = requestedPermissions(worktree);
  const unknown = requested.length ? needs.filter((permission) => !requested.includes(permission)) : [];
  if (unknown.length) {
    throw new QaError(
      "USAGE",
      `--needs names permissions this Signals build does not request: ${unknown.join(", ")}. ` +
        `It requests: ${requested.join(", ")}.`,
    );
  }
  return needs;
}

// RealTimeX shows the user a permission dialog when a Local App registers and records the answer
// in local_apps.metadata, as it does for edits in Settings → Local Apps. The CLI does not expose
// those decisions, so they are read from the database, read-only.
function appPermissions(dbPath, appId, worktree) {
  const query = `select metadata from local_apps where id = '${String(appId).replace(/'/g, "''")}';`;
  const result = spawnSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", dbPath, query], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  let decided = {};
  try {
    const rows = JSON.parse(String(result.stdout || "").trim() || "[]");
    decided = JSON.parse(rows[0]?.metadata || "{}")?.permissions || {};
  } catch {
    decided = {};
  }
  const granted = Array.isArray(decided.granted) ? decided.granted : [];
  const denied = Array.isArray(decided.denied) ? decided.denied : [];
  const pending = requestedPermissions(worktree).filter(
    (permission) => !granted.includes(permission) && !denied.includes(permission),
  );
  return { granted, denied, pending, lastPromptedAt: decided.lastPromptedAt ?? null };
}

// Only the user can grant, so up waits for their decision on the dialog (RealTimeX holds it open
// for two minutes) and stops early once a needed permission is denied.
async function waitForNeeds(dbPath, appId, worktree, needs, pollMs) {
  const deadline =
    Date.now() + positiveInt(process.env.SIGNALS_QA_PERMISSION_WAIT_MS, PERMISSION_WAIT_MS);
  for (;;) {
    const permissions = appPermissions(dbPath, appId, worktree);
    const missing = needs.filter((permission) => !permissions?.granted.includes(permission));
    const denied = needs.filter((permission) => permissions?.denied.includes(permission));
    if (!missing.length || denied.length || Date.now() >= deadline) {
      return { permissions, missing, denied };
    }
    await sleep(pollMs);
  }
}

function qaIssueLockPath(issueId) {
  return join(qaTemporaryRoot(), `signals-qa-local-app-issue-${issueId}.lock`);
}

// Two overlapping ups for one issue can both pass preflight before either receipt exists, and the
// loser leaves an untracked app behind. up and down therefore hold a per-issue lock.
function acquireIssueLock(issueId, action) {
  const path = qaIssueLockPath(issueId);
  try {
    return acquireLockFile(path, action);
  } catch (error) {
    if (!(error instanceof IssueLockBusyError)) throw error;
    throw new QaError("QA_LOCKED", `${error.message} One up or down runs per issue at a time.`, {
      // The holder record comes from a file anyone can write; spread it first so it cannot
      // overwrite the path and reason this run determined.
      lock: { ...(error.holder ?? {}), path, reason: error.reason },
      next:
        error.reason === "unreadable"
          ? `Rerun after 30 s; if it persists, inspect ${path} before removing it.`
          : "Wait for that run to finish, then rerun.",
    });
  }
}

function resolveHost(name) {
  const host = HOSTS[name || "packaged"];
  if (!host) throw new QaError("USAGE", `--host must be packaged or dev; received ${name}.`);
  return host;
}

function hostFromBaseUrl(baseUrl) {
  return Object.values(HOSTS).find((host) => host.baseUrl === baseUrl) ?? null;
}

function passThrough(flags, names) {
  return names.flatMap((name) => (flags.get(name) ? [`--${name}`, flags.get(name)] : []));
}

function classifyCliError(error, host) {
  const message = String(error?.message || error);
  if (/connection refused|dial tcp|no such host|EHOSTUNREACH|i\/o timeout/i.test(message)) {
    return new QaError(
      "HOST_UNREACHABLE",
      `No RealTimeX host answers at ${host.baseUrl}.`,
      {
        cliError: message,
        next:
          host.name === "packaged"
            ? "Open the RealTimeX desktop app, then rerun. Do not start a dev host for this."
            : "Start the dev host with yarn dev:all in the realtimex-ai-app checkout, then rerun.",
      },
    );
  }
  if (/HTTP 40[13]|LOCAL_APP_PEER_MANAGEMENT_FORBIDDEN|TERMINAL_SESSION_NOT_ACTIVE/i.test(message)) {
    return new QaError(
      "LOCAL_APP_MANAGEMENT_REFUSED",
      `The ${host.name} host at ${host.baseUrl} refuses Local App management from this identity.`,
      {
        cliError: message,
        next:
          host.name === "dev"
            ? 'Ask the user for a scoped CLI key (dev app Settings → API Keys, local-apps:* scopes), then pass --cli <wrapper> that runs realtimex-pp-cli --credential-ref <ref> "$@".'
            : "Run this from a RealTimeX terminal session of the packaged app.",
      },
    );
  }
  return new QaError("HOST_ERROR", message);
}

function cli(args, cliOptions, host) {
  try {
    return runRealtimeXCli(args, cliOptions);
  } catch (error) {
    throw classifyCliError(error, host);
  }
}

function runtimeOf(payload) {
  const body = payload?.results ?? payload?.result ?? payload?.data ?? payload;
  return body?.runtime ?? null;
}

function recentLogs(appId, cliOptions, limit = 40) {
  try {
    const payload = runRealtimeXCli(
      ["get-local-app-logs", appId, "--limit", String(limit)],
      cliOptions,
    );
    const body = payload?.results ?? payload;
    return (body?.logs ?? []).map((entry) => {
      const text = String(entry?.content ?? "").replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
      return `${entry?.type === "stderr" ? "err" : "out"} ${text}`;
    });
  } catch (error) {
    return [`(could not read logs: ${error.message})`];
  }
}

function runQaScript(script, args, env = {}) {
  const result = spawnSync(process.execPath, [join(SCRIPT_DIR, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = String(result.stdout || "").trim();
  let json = null;
  if (stdout.includes("{")) {
    try {
      json = JSON.parse(stdout.slice(stdout.indexOf("{")));
    } catch {
      json = null;
    }
  }
  return { ok: result.status === 0, json, stderr: String(result.stderr || "").trim() };
}

// Next 16 holds <dir>/.next/dev/lock for as long as `next dev` runs there and refuses a second
// dev server in the same directory, so a QA app started over a live lock crashes on boot.
function liveNextDevLock(worktree) {
  const lockPath = join(worktree, ".next", "dev", "lock");
  if (!existsSync(lockPath)) return null;
  let info = {};
  try {
    info = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
  const pid = Number(info.pid);
  if (!pidAlive(pid)) return null;
  // A recycled pid is not a dev server. Next titles its dev process "next-server (vX)".
  const ps = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  if (ps.status === 0 && !/next/i.test(ps.stdout)) return null;
  return {
    lockPath,
    pid,
    port: Number(info.port) || null,
    appUrl: info.appUrl ?? null,
    startedAt: Number(info.startedAt) || null,
  };
}

// RealTimeX leaves runtime.runningPort null for minutes when the app's config pins no port, which
// is how QA apps are created. Next writes the bound port into the lock as soon as it listens, and
// up refuses to start over a live lock, so a live lock written after this start is the QA app's.
function resolveServingPort(runtime, worktree) {
  if (runtime?.runningPort) return { port: runtime.runningPort, portSource: "realtimex" };
  const lock = worktree ? liveNextDevLock(worktree) : null;
  const startedAt = Number(runtime?.startTime) || 0;
  if (lock?.port && (!startedAt || !lock.startedAt || lock.startedAt + 5000 >= startedAt)) {
    return { port: lock.port, portSource: "next-lock" };
  }
  return { port: null, portSource: null };
}

function readCanonicalRows(dbPath) {
  if (!existsSync(dbPath)) {
    throw new QaError("DB_NOT_FOUND", `RealTimeX database not found: ${dbPath}`);
  }
  const query =
    "select id, display_name, name, config, tags from local_apps " +
    `where id = '${CANONICAL_SIGNALS_APP_ID}';`;
  const result = spawnSync(
    "sqlite3",
    ["-readonly", "-json", "-cmd", ".timeout 5000", dbPath, query],
    { encoding: "utf8" },
  );
  if (result.error?.code === "ENOENT") {
    throw new QaError(
      "SQLITE3_MISSING",
      "The sqlite3 CLI is not on PATH; qa-local-app needs it to snapshot the canonical record.",
      { next: "Install sqlite3 3.33 or newer (it ships with macOS), then rerun." },
    );
  }
  if (result.status !== 0) {
    throw new QaError(
      "DB_UNREADABLE",
      result.stderr?.trim() || `sqlite3 exited with ${result.status} reading ${dbPath}.`,
    );
  }
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function changedCanonicalFields(before, after) {
  const parse = (rows) => {
    const row = rows[0];
    if (!row) return null;
    let config = {};
    try {
      config = JSON.parse(row.config || "{}");
    } catch {
      config = { unparsable: row.config };
    }
    return { ...row, config };
  };
  const a = parse(before);
  const b = parse(after);
  if (!a || !b) return [a ? "record deleted" : "record created"];
  const fields = [];
  for (const key of ["id", "display_name", "name", "tags"]) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) fields.push(key);
  }
  const keys = new Set([...Object.keys(a.config), ...Object.keys(b.config)]);
  for (const key of keys) {
    if (key === "env") continue;
    if (JSON.stringify(a.config[key]) !== JSON.stringify(b.config[key])) fields.push(`config.${key}`);
  }
  const envKeys = new Set([...Object.keys(a.config.env || {}), ...Object.keys(b.config.env || {})]);
  for (const key of envKeys) {
    if (a.config.env?.[key] !== b.config.env?.[key]) fields.push(`config.env.${key}`);
  }
  return fields;
}

async function probeHealth(port, timeoutMs) {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { url, status: response.status, ok: response.ok };
  } catch (error) {
    return { url, status: null, ok: false, error: error.cause?.code || error.name || String(error) };
  }
}

function portAnswers(port, timeoutMs = 1000) {
  return new Promise((resolvePort) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolvePort(value);
    };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitPortReleased(port, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portAnswers(port))) return true;
    await sleep(pollMs);
  }
  return !(await portAnswers(port));
}

async function waitUntilServing(appId, cliOptions, host, { timeoutMs, pollMs, worktree }) {
  const deadline = Date.now() + timeoutMs;
  let runtime = null;
  let health = null;
  let served = { port: null, portSource: null };
  let sawRunning = false;
  let stoppedSince = null;
  while (Date.now() < deadline) {
    runtime = runtimeOf(cli(["get-local-app-status", appId], cliOptions, host));
    const status = String(runtime?.status || "unknown");
    if (FAILED_STATUSES.has(status)) {
      throw new QaError("START_FAILED", `The QA Local App reported ${status} while starting.`, {
        runtime,
        logs: recentLogs(appId, cliOptions),
      });
    }
    if (status === "running") {
      sawRunning = true;
      stoppedSince = null;
      served = resolveServingPort(runtime, worktree);
      if (served.port) {
        const remaining = Math.max(1000, Math.min(30_000, deadline - Date.now()));
        health = await probeHealth(served.port, remaining);
        if (health.ok) return { runtime, health, ...served };
      }
    } else if (status === "stopped") {
      stoppedSince ??= Date.now();
      if (sawRunning || Date.now() - stoppedSince > STOPPED_GRACE_MS) {
        throw new QaError(
          "START_FAILED",
          sawRunning
            ? "The QA Local App stopped after it started."
            : "The QA Local App never left the stopped state.",
          { runtime, logs: recentLogs(appId, cliOptions) },
        );
      }
    }
    await sleep(pollMs);
  }
  let errorCode = "START_TIMEOUT";
  let message = `The QA Local App did not reach running within ${timeoutMs} ms.`;
  if (sawRunning && served.port) {
    errorCode = "HEALTH_TIMEOUT";
    message = `The QA Local App runs on port ${served.port} but /api/health did not return 200 within ${timeoutMs} ms.`;
  } else if (sawRunning) {
    errorCode = "PORT_UNKNOWN";
    message = `The QA Local App runs, but neither RealTimeX nor ${worktree}/.next/dev/lock reported its port within ${timeoutMs} ms.`;
  }
  throw new QaError(errorCode, message, {
    runtime,
    health,
    logs: recentLogs(appId, cliOptions),
  });
}

function upResult({ reused, issueId, host, appId, worktree, receipt, receiptPath, sessionPath, port, portSource, health, permissions, next }) {
  return {
    ok: true,
    action: "up",
    reused,
    issueId,
    host: host.name,
    baseUrl: host.baseUrl,
    appId,
    displayName: qaAppDisplayName(issueId),
    worktree: worktree.path,
    branch: worktree.branch,
    port,
    portSource,
    dashboardUrl: `http://127.0.0.1:${port}/dashboard`,
    healthUrl: health.url,
    permissions,
    dataDir: receipt?.dataDir ?? null,
    receiptPath,
    sessionPath,
    next,
  };
}

async function up(flags) {
  const issueId = normalizeIssueId(flags.get("issue"));
  const host = resolveHost(flags.get("host"));
  const dbPath =
    flags.get("db") || process.env.RTX_DB_PATH?.trim() || realtimexDbPath(host.storageRoot);
  const waitOptions = {
    timeoutMs: positiveInt(flags.get("timeout-ms"), DEFAULT_TIMEOUT_MS),
    pollMs: positiveInt(process.env.SIGNALS_QA_POLL_MS, 1000),
  };

  let worktree;
  try {
    worktree = assertSignalsIssueWorktree(flags.get("worktree") || process.cwd());
  } catch (error) {
    throw new QaError("WORKTREE_INVALID", error.message, {
      next: "Run up from a linked Signals issue worktree, or pass --worktree <path>.",
    });
  }
  const needs = parseNeeds(flags, worktree.path);

  const release = acquireIssueLock(issueId, "up");
  try {
    const receiptPath = qaReceiptPath(issueId);
    const sessionPath = qaSessionPath(issueId);
    const receipt = readJson(receiptPath);
    // A rerun on the dev host needs the credential wrapper before its first CLI call, so a
    // session for this host lends its recorded CLI; an explicit --cli still wins.
    const priorSession = readJson(sessionPath);
    const cliPath =
      flags.get("cli") || (priorSession?.baseUrl === host.baseUrl ? priorSession.cli || "" : "");
    const cliOptions = { baseUrl: host.baseUrl, cli: cliPath };
    const downCmd = followUp("down", issueId, { host: host.name, cli: cliPath, db: flags.get("db") });
    // Reports what the app may do, and holds up for the permissions the scenario needs. Leaves
    // the app running on failure, since the user grants against that app.
    const checkPermissions = async (appId) => {
      if (!needs.length) return appPermissions(dbPath, appId, worktree.path);
      const { permissions, missing, denied } = await waitForNeeds(
        dbPath,
        appId,
        worktree.path,
        needs,
        waitOptions.pollMs,
      );
      if (!missing.length) return permissions;
      const rerunUp = `${followUp("up", issueId, {
        host: host.name,
        cli: cliPath,
        db: flags.get("db"),
        needs,
      })} --worktree ${shellQuote(worktree.path)}`;
      throw new QaError(
        "PERMISSIONS_MISSING",
        `${qaAppDisplayName(issueId)} lacks ${missing.join(", ")}` +
          (denied.length ? `, and the user denied ${denied.join(", ")}` : "") +
          ". Agents cannot grant RealTimeX permissions.",
        {
          permissions,
          missing,
          denied,
          next:
            `Ask the user to grant ${missing.join(", ")} to "${qaAppDisplayName(issueId)}" in ` +
            `RealTimeX (its permission dialog, or Settings → Local Apps), then rerun: ${rerunUp}`,
        },
      );
    };
    const issueApps = findIssueQaApps(appsFromCliPayload(cli(LIST_ARGS, cliOptions, host)), issueId);

    if (receipt) {
      const app = issueApps.find((candidate) => candidate.id === receipt.appId);
      const sameTarget = receipt.worktree === worktree.path && receipt.baseUrl === host.baseUrl;
      if (!app || !sameTarget || issueApps.length !== 1) {
        throw new QaError(
          "QA_APP_EXISTS",
          `${receiptPath} records ${receipt.worktree} on ${receipt.baseUrl}` +
            (app ? "." : ", and that app no longer exists."),
          { receipt, next: downCmd },
        );
      }
      try {
        assertSafeQaApp(app, issueId);
      } catch (error) {
        throw new QaError("QA_APP_UNSAFE", error.message, {
          next:
            "The receipt-backed app no longer carries its safety tags, so neither up nor down " +
            "will touch it. Tell the user; do not delete it by hand.",
        });
      }
      // The session holds the canonical baseline taken before provisioning. Recapturing it now
      // would hide any change QA already made, so reuse requires the original session.
      const session = priorSession;
      if (!session || (session.appId && session.appId !== app.id)) {
        throw new QaError(
          "QA_SESSION_MISSING",
          `${receiptPath} exists but ${sessionPath} ` +
            (session ? `belongs to app ${session.appId}` : "does not") +
            ", so the canonical baseline from before provisioning is gone.",
          { next: `${downCmd}, then rerun up.` },
        );
      }
      let served;
      try {
        const status = String(app.runtime?.status || app.persistedStatus || "");
        if (status !== "running") cli(["start-local-app", app.id], cliOptions, host);
        served = await waitUntilServing(app.id, cliOptions, host, {
          ...waitOptions,
          worktree: worktree.path,
        });
      } catch (error) {
        if (error instanceof QaError) {
          error.extra.next = `Read the logs above, then ${downCmd} before retrying up.`;
        }
        throw error;
      }
      writeSession(sessionPath, {
        ...session,
        appId: app.id,
        port: served.port,
        cli: cliPath || session.cli || null,
      });
      const permissions = await checkPermissions(app.id);
      return upResult({
        reused: true,
        issueId,
        host,
        appId: app.id,
        worktree,
        receipt,
        receiptPath,
        sessionPath,
        permissions,
        next: downCmd,
        ...served,
      });
    }

    if (issueApps.length) {
      throw new QaError(
        "QA_APP_EXISTS",
        `${issueApps.length} ${qaAppDisplayName(issueId)} record(s) exist without a receipt: ` +
          `${issueApps.map((app) => app.id).join(", ")}.`,
        { next: followUp("down", issueId, { cli: cliPath, db: flags.get("db"), host: host.name }) },
      );
    }

    const lock = liveNextDevLock(worktree.path);
    if (lock) {
      throw new QaError(
        "NEXT_DEV_ALREADY_RUNNING",
        `next dev (pid ${lock.pid}${lock.appUrl ? `, ${lock.appUrl}` : ""}) already holds ` +
          `${lock.lockPath}. Next 16 allows one dev server per directory, so the QA app would ` +
          "crash during startup.",
        { lock, next: `Stop that server (kill ${lock.pid}) if you started it, then rerun up.` },
      );
    }

    const session = {
      schemaVersion: 1,
      kind: "signals-qa-local-app-session",
      issueId,
      host: host.name,
      baseUrl: host.baseUrl,
      dbPath,
      cli: cliPath || null,
      worktree: worktree.path,
      canonicalRows: readCanonicalRows(dbPath),
      canonicalCapturedAt: new Date().toISOString(),
      appId: null,
      port: null,
    };
    writeSession(sessionPath, session);

    const provision = runQaScript("provision-signals-qa-local-app.mjs", [
      "--issue",
      issueId,
      "--worktree",
      worktree.path,
      "--base-url",
      host.baseUrl,
      ...passThrough(flags, ["loop-id", "workspace-slug", "cli"]),
    ]);
    if (!provision.ok || !provision.json?.appId) {
      throw new QaError(
        "PROVISION_FAILED",
        provision.stderr.replace(/^QA Local App provision failed: /, "") ||
          "The provisioner returned no app id.",
        { next: `${downCmd}, then rerun up.` },
      );
    }
    const appId = provision.json.appId;
    writeSession(sessionPath, { ...session, appId });

    let served;
    try {
      served = await waitUntilServing(appId, cliOptions, host, {
        ...waitOptions,
        worktree: worktree.path,
      });
    } catch (error) {
      if (error instanceof QaError) {
        error.extra.next = `Read the logs above, then ${downCmd} before retrying up.`;
      }
      throw error;
    }
    writeSession(sessionPath, { ...session, appId, port: served.port });
    const permissions = await checkPermissions(appId);
    return upResult({
      reused: false,
      issueId,
      host,
      appId,
      worktree,
      receipt: readJson(receiptPath),
      receiptPath,
      sessionPath,
      permissions,
      next: downCmd,
      ...served,
    });
  } finally {
    release();
  }
}

async function status(flags) {
  const issueId = normalizeIssueId(flags.get("issue"));
  const receiptPath = qaReceiptPath(issueId);
  const receipt = readJson(receiptPath);
  const session = readJson(qaSessionPath(issueId));
  const host =
    hostFromBaseUrl(receipt?.baseUrl || session?.baseUrl) || resolveHost(flags.get("host"));
  const cliOptions = { baseUrl: host.baseUrl, cli: flags.get("cli") || session?.cli || "" };
  const dbPath =
    flags.get("db") ||
    session?.dbPath ||
    process.env.RTX_DB_PATH?.trim() ||
    realtimexDbPath(host.storageRoot);
  const issueApps = findIssueQaApps(appsFromCliPayload(cli(LIST_ARGS, cliOptions, host)), issueId);
  const app = receipt
    ? issueApps.find((candidate) => candidate.id === receipt.appId)
    : issueApps[0];
  const worktreePath = receipt?.worktree ?? session?.worktree;
  let runtime = null;
  let health = null;
  let served = { port: null, portSource: null };
  if (app) {
    runtime = runtimeOf(cli(["get-local-app-status", app.id], cliOptions, host));
    if (runtime?.status === "running") {
      served = resolveServingPort(runtime, worktreePath);
      if (served.port) health = await probeHealth(served.port, 5000);
    }
  }
  const permissions = app ? appPermissions(dbPath, app.id, worktreePath) : null;
  const { port, portSource } = served;
  return {
    ok: true,
    action: "status",
    issueId,
    host: host.name,
    present: Boolean(app),
    appId: app?.id ?? null,
    status: runtime?.status ?? null,
    port,
    portSource,
    healthy: Boolean(health?.ok),
    permissions,
    dashboardUrl: port ? `http://127.0.0.1:${port}/dashboard` : null,
    worktree: receipt?.worktree ?? null,
    receiptPath: receipt ? receiptPath : null,
    strayApps: issueApps.filter((candidate) => candidate.id !== app?.id).map((candidate) => candidate.id),
  };
}

async function down(flags) {
  const issueId = normalizeIssueId(flags.get("issue"));
  const receipt = readJson(qaReceiptPath(issueId));
  const sessionPath = qaSessionPath(issueId);
  const session = readJson(sessionPath);
  const host =
    hostFromBaseUrl(receipt?.baseUrl || session?.baseUrl) || resolveHost(flags.get("host"));
  const cliPath = flags.get("cli") || session?.cli || "";
  const dbPath =
    flags.get("db") ||
    session?.dbPath ||
    process.env.RTX_DB_PATH?.trim() ||
    realtimexDbPath(host.storageRoot);
  const rerun = followUp("down", issueId, {
    host: host.name,
    cli: cliPath,
    db: flags.get("db"),
    keepData: flags.has("keep-data"),
  });
  const pollMs = positiveInt(process.env.SIGNALS_QA_POLL_MS, 1000);
  const releaseWaitMs = positiveInt(process.env.SIGNALS_QA_PORT_RELEASE_MS, PORT_RELEASE_MS);

  const release = acquireIssueLock(issueId, "down");
  try {
    // Read the port before cleanup stops the app, in case up failed before recording it.
    const port =
      session?.port ??
      resolveServingPort(null, receipt?.worktree ?? session?.worktree).port ??
      null;

    const cleanup = runQaScript("cleanup-signals-qa-local-app.mjs", [
      "--issue",
      issueId,
      ...(flags.has("keep-data") ? ["--keep-data"] : []),
      ...(receipt ? [] : ["--base-url", host.baseUrl]),
      ...(cliPath ? ["--cli", cliPath] : []),
    ]);
    if (!cleanup.ok) {
      throw new QaError(
        "CLEANUP_FAILED",
        cleanup.stderr.replace(/^QA Local App cleanup failed: /, "") || "Cleanup failed.",
        { next: `Resolve the cause above, then rerun: ${rerun}` },
      );
    }

    const hygiene = runQaScript(
      "verify-signals-local-app-hygiene.mjs",
      ["--issue", issueId, "--db", dbPath, "--canonical-repo", canonicalSignalsRepoRoot(SCRIPT_DIR)],
      { REALTIMEX_RUNTIME: host.runtime },
    );
    const hygieneProblems = hygiene.ok
      ? []
      : hygiene.stderr
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .map((line) => line.slice(2).trim());
    if (!hygiene.ok && !hygieneProblems.length) hygieneProblems.push(hygiene.stderr);

    const canonicalNow = readCanonicalRows(dbPath);
    const canonicalUnchanged = session
      ? JSON.stringify(canonicalNow) === JSON.stringify(session.canonicalRows)
      : null;
    const portReleased = port ? await waitPortReleased(port, releaseWaitMs, pollMs) : null;

    const failures = [];
    if (canonicalUnchanged === false) failures.push("CANONICAL_CHANGED");
    if (!hygiene.ok) failures.push("HYGIENE_FAILED");
    if (portReleased === false) failures.push("PORT_STILL_BOUND");

    const result = {
      ok: failures.length === 0,
      action: "down",
      issueId,
      host: host.name,
      appId: cleanup.json?.appId ?? null,
      appDeleted: cleanup.json?.appDeleted ?? null,
      dataRemoved: cleanup.json?.dataRemoved ?? null,
      hygiene: hygiene.ok ? "pass" : { problems: hygieneProblems },
      canonicalUnchanged,
      port,
      portReleased,
    };
    if (canonicalUnchanged === null) {
      result.warnings = ["No snapshot from up for this issue, so the canonical record was not diffed."];
    }
    if (failures.length) {
      result.errorCode = failures[0];
      result.failures = failures;
      if (canonicalUnchanged === false) {
        result.changedFields = changedCanonicalFields(session.canonicalRows, canonicalNow);
        result.error = "The canonical Signals record changed while this QA app existed.";
        result.next =
          host.name === "packaged"
            ? "Stop and tell the user. Do not run --restore-canonical against the packaged host."
            : `Restore it with provision-signals-local-app.mjs --restore-canonical (dev host only), then rerun: ${rerun}`;
      } else if (!hygiene.ok) {
        result.error = `Hygiene gate failed: ${hygieneProblems.join("; ")}`;
        result.next = `Resolve the listed problems, then rerun: ${rerun}`;
      } else {
        result.error = `Port ${port} still answers after the QA app was deleted.`;
        result.next = `Find the listener with lsof -iTCP:${port} -sTCP:LISTEN, stop it if QA started it, then rerun: ${rerun}`;
      }
    } else {
      rmSync(sessionPath, { force: true });
    }
    return result;
  } finally {
    release();
  }
}

const COMMANDS = { up, status, down };

const [command, ...rest] = process.argv.slice(2);
const action = command || "help";
try {
  if (!command || command === "--help" || command === "help") {
    console.log(usage());
    process.exit(command ? 0 : 2);
  }
  if (!COMMANDS[command]) throw new QaError("USAGE", `Unknown command ${command}.\n\n${usage()}`);
  const flags = parseFlagArgs(rest);
  if (flags.has("help")) {
    console.log(usage());
    process.exit(0);
  }
  const result = await COMMANDS[command](flags);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.stderr.write(`qa-local-app ${action}: ${result.errorCode}: ${result.error}\n`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const coded = error instanceof QaError ? error : new QaError("UNEXPECTED", error?.message || String(error));
  const result = { ok: false, action, errorCode: coded.errorCode, error: coded.message, ...coded.extra };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`qa-local-app ${action}: ${coded.errorCode}: ${coded.message}\n`);
  process.exit(coded.errorCode === "USAGE" ? 2 : 1);
}
