#!/usr/bin/env node
/**
 * One entry point for Signals Dev Local Apps on the RealTimeX Dev host (AGENTS.md §10, #541,
 * specs/signals-dev-local-app.md). Every Signals checkout, the main one included, gets its own
 * app, keyed by the checkout's realpath:
 *
 *   up      preflight -> slot lock -> installed-app snapshot -> create or reuse -> start ->
 *           wait for /api/health -> verify the dev-instance guard -> permissions
 *   status  where the checkout's app is and whether it answers
 *   down    stop -> port released -> Dev-host invariant -> installed app untouched (keeps the app)
 *   remove  stop -> delete the app -> delete its data (unless --keep-data)
 *   prune   plan (or --apply) deletion of apps and slots whose checkout is gone
 *
 * It manages only the Dev host (127.0.0.1:3101) and never starts it. The installed app's database
 * is read, read-only, to prove nothing touched it. Every command prints one JSON object and exits
 * 0 only when `ok` is true; failures carry `errorCode` and `next`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import net from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { IssueLockBusyError, acquireIssueLock as acquireLockFile, pidAlive } from "./qa-issue-lock.mjs";
import {
  CANONICAL_SIGNALS_APP_ID,
  appDisplayName,
  appFromCliPayload,
  appsFromCliPayload,
  assertSafeQaDataDir,
  canonicalConfigProblems,
  canonicalSignalsRepoRoot,
  legacyQaStatePaths,
  marketplaceDeployRoot,
  parseFlagArgs,
  realtimexDbPath,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";
import {
  DEV_HOST_BASE_URL,
  PORT_RANGE_SIZE,
  PORT_RANGE_START,
  RESERVED_PORTS,
  SlotError,
  buildDevCreateCliArgs,
  devAppDisplayName,
  devAppTags,
  devHostProblems,
  devWorkspaceSlug,
  diffPackagedHost,
  hostConfigPath,
  isDevRow,
  legacyQaIssueId,
  listSlotReceipts,
  normalizeOptionalIssueId,
  packagedHostFingerprint,
  pinnedPorts,
  pointsAtRealSignalsData,
  prepareSlotData,
  readJsonFile,
  resolveSignalsCheckout,
  resolveSlot,
  rowConfig,
  rowTags,
  signalsDevRoot,
  slotAppProblems,
  slotPaths,
  worktreeHash,
} from "./signals-dev-local-app.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = join(SCRIPT_DIR, "qa-local-app.mjs");
const MIGRATE = join(SCRIPT_DIR, "migrate-dev-signals-row.mjs");
const LIST_ARGS = ["list-local-apps", "--data-source", "live", "--no-cache"];
const DEFAULT_TIMEOUT_MS = 240_000;
const STOPPED_GRACE_MS = 15_000;
const PORT_RELEASE_MS = 20_000;
// RealTimeX holds its permission dialog open for 120 s; allow a little beyond that.
const PERMISSION_WAIT_MS = 150_000;
const FAILED_STATUSES = new Set(["error", "crashed", "failed"]);
const PROFILES = new Set(["empty", "snapshot"]);

const QaError = SlotError;

function usage() {
  return `Usage:
  node scripts/qa/qa-local-app.mjs up [--worktree <path>] [--profile empty|snapshot] \\
    [--needs llm.chat,desktop.runtime-sessions] [--issue N] [--loop-id id] \\
    [--cli <wrapper>] [--db <dev realtimex.db>] [--timeout-ms 240000]
  node scripts/qa/qa-local-app.mjs status [--worktree <path>]
  node scripts/qa/qa-local-app.mjs down   [--worktree <path>]
  node scripts/qa/qa-local-app.mjs remove [--worktree <path>] [--keep-data]
  node scripts/qa/qa-local-app.mjs prune  [--apply] [--legacy-qa]

Each Signals checkout (default: the current directory, primary or linked) gets one
"Signals Dev · <slot>" Local App on the RealTimeX Dev host (127.0.0.1:3101), with its own port,
data under ~/.signals-dev/<slot>, and workspace signals-dev-<slot>. The app runs with
SIGNALS_INSTANCE=dev, so Signals refuses to publish, send, or connect accounts.

up      Creates or reuses the app, starts it, waits for /api/health, and verifies the instance
        guard. --profile snapshot copies the real data.db (read-only) and media/ into a new slot,
        with stored platform credentials removed. --needs waits for the owner to grant the named
        RealTimeX permissions and fails with PERMISSIONS_MISSING otherwise; agents cannot grant
        them. --no-start creates the app without starting it.
status  Reports the app, its health and instance guard, permissions, and stale slots.
down    Stops the app and checks the port, the Dev host, and the installed app. Keeps the app, its
        data, and its permissions. QA hands off passed only after down exits 0.
remove  Deletes the app and its data (--keep-data keeps the data). Run it at loop close.
prune   Lists apps and slots whose checkout is gone; --apply deletes them. --legacy-qa also
        includes the pre-#541 "Signals issue-<N> QA" apps and their /private/tmp data.

--cli <path> replaces realtimex-pp-cli: an executable wrapper that runs
        realtimex-pp-cli --credential-ref <ref> "$@" with the owner's scoped local-apps key.
--db <path> is the Dev host's realtimex.db; --packaged-db <path> the installed app's (read-only).
        up records --cli, --db and --packaged-db in ~/.signals-dev/.launcher/host.json; later
        commands reuse them, and explicit flags win.
One up, down, or remove runs per slot at a time.

Prints one JSON object. Exit 0 only when ok is true; failures carry errorCode and next.`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shellQuote(value) {
  const text = String(value);
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

// --- Context -------------------------------------------------------------------------------------

/** The CLI and databases this run uses. Explicit flags win over host.json; nothing reaches 3001. */
function hostContext(flags) {
  const hostFlag = flags.get("host");
  if (hostFlag === "packaged") {
    throw new QaError(
      "HOST_PACKAGED_FORBIDDEN",
      "Signals Dev apps live only on the RealTimeX Dev host; the installed app is the owner's.",
      { next: "Drop --host; the launcher always targets the Dev host (127.0.0.1:3101)." },
    );
  }
  if (hostFlag && hostFlag !== "dev") {
    throw new QaError("USAGE", `--host is no longer supported; received ${hostFlag}.`, {
      next: "Drop --host; the launcher always targets the Dev host.",
    });
  }
  const recorded = readJsonFile(hostConfigPath()) ?? {};
  if (recorded.baseUrl && recorded.baseUrl !== DEV_HOST_BASE_URL) {
    throw new QaError(
      "HOST_PACKAGED_FORBIDDEN",
      `${hostConfigPath()} records ${recorded.baseUrl}; the launcher only manages ${DEV_HOST_BASE_URL}.`,
      { next: `Delete ${hostConfigPath()} and rerun with explicit --cli and --db.` },
    );
  }
  const packagedDbPath = resolve(
    flags.get("packaged-db") || recorded.packagedDbPath || realtimexDbPath("app"),
  );
  const dbPath = resolve(flags.get("db") || recorded.dbPath || realtimexDbPath("dev"));
  if (dbPath === packagedDbPath || dbPath.includes(`${sep}app${sep}users${sep}`)) {
    throw new QaError(
      "HOST_PACKAGED_FORBIDDEN",
      `--db ${dbPath} is the installed app's database; Signals Dev apps live on the Dev host.`,
      { next: `Pass the Dev host database, e.g. --db ${realtimexDbPath("dev")}.` },
    );
  }
  return { cli: flags.get("cli") || recorded.cli || "", dbPath, packagedDbPath };
}

function recordHostContext(ctx) {
  writePrivateJson(hostConfigPath(), {
    baseUrl: DEV_HOST_BASE_URL,
    cli: ctx.cli || null,
    dbPath: ctx.dbPath,
    packagedDbPath: ctx.packagedDbPath,
    updatedAt: new Date().toISOString(),
  });
}

function resolveCheckout(flags) {
  try {
    return resolveSignalsCheckout(flags.get("worktree") || process.cwd());
  } catch (error) {
    throw new QaError("WORKTREE_INVALID", error.message, {
      next: "Run from a Signals checkout (primary or linked worktree), or pass --worktree <path>.",
    });
  }
}

function followUp(action, checkout, ctx, { keepData = false, needs = [], profile = null } = {}) {
  return [
    "node",
    shellQuote(SELF),
    action,
    "--worktree",
    shellQuote(checkout.path),
    ...(ctx.cli ? ["--cli", shellQuote(ctx.cli)] : []),
    "--db",
    shellQuote(ctx.dbPath),
    "--packaged-db",
    shellQuote(ctx.packagedDbPath),
    ...(profile ? ["--profile", profile] : []),
    ...(keepData ? ["--keep-data"] : []),
    ...(needs.length ? ["--needs", needs.join(",")] : []),
  ].join(" ");
}

// --- RealTimeX CLI -------------------------------------------------------------------------------

function classifyCliError(error) {
  const message = String(error?.message || error);
  if (/connection refused|dial tcp|no such host|EHOSTUNREACH|ECONNREFUSED|i\/o timeout/i.test(message)) {
    return new QaError("HOST_UNREACHABLE", `No RealTimeX Dev host answers at ${DEV_HOST_BASE_URL}.`, {
      cliError: message,
      next:
        "Ask the owner to start RealTimeX Dev (yarn dev:all in the realtimex-ai-app checkout), then " +
        "rerun. This launcher never starts it.",
    });
  }
  if (/HTTP 40[13]|LOCAL_APP_PEER_MANAGEMENT_FORBIDDEN|TERMINAL_SESSION_NOT_ACTIVE|scope/i.test(message)) {
    return new QaError(
      "LOCAL_APP_MANAGEMENT_REFUSED",
      `The Dev host at ${DEV_HOST_BASE_URL} refuses Local App management from this identity.`,
      {
        cliError: message,
        next:
          "Ask the owner for a never-expiring scoped CLI key (RealTimeX Dev → Settings → API Keys, " +
          'local-apps scopes), then pass --cli <wrapper> that runs realtimex-pp-cli --credential-ref <ref> "$@".',
      },
    );
  }
  return new QaError("HOST_ERROR", message, {
    next: `Check that the Dev host at ${DEV_HOST_BASE_URL} is healthy, then rerun.`,
  });
}

function cli(args, ctx) {
  try {
    return runRealtimeXCli(args, { baseUrl: DEV_HOST_BASE_URL, cli: ctx.cli });
  } catch (error) {
    throw classifyCliError(error);
  }
}

function listApps(ctx) {
  return appsFromCliPayload(cli(LIST_ARGS, ctx));
}

function runtimeOf(payload) {
  const body = payload?.results ?? payload?.result ?? payload?.data ?? payload;
  return body?.runtime ?? null;
}

function appStatus(app) {
  return String(app?.runtime?.status || app?.persistedStatus || app?.status || "");
}

// Scoped keys may not read logs (no scope maps to get-local-app-logs); failures read as a note.
function recentLogs(appId, ctx, limit = 40) {
  try {
    const payload = runRealtimeXCli(["get-local-app-logs", appId, "--limit", String(limit)], {
      baseUrl: DEV_HOST_BASE_URL,
      cli: ctx.cli,
    });
    const body = payload?.results ?? payload;
    return (body?.logs ?? []).map((entry) => {
      const text = String(entry?.content ?? "").replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
      return `${entry?.type === "stderr" ? "err" : "out"} ${text}`;
    });
  } catch (error) {
    return [`(could not read logs: ${error.message})`];
  }
}

function stopApp(appId, ctx) {
  cli(["stop-local-app", appId], ctx);
}

// --- Databases (read-only) -----------------------------------------------------------------------

function queryDb(dbPath, query, what) {
  if (!existsSync(dbPath)) {
    throw new QaError("DB_NOT_FOUND", `${what} database not found: ${dbPath}`, {
      next: what === "Dev host" ? "Pass --db for the RealTimeX Dev host." : "Pass --packaged-db for the installed app.",
    });
  }
  const result = spawnSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", dbPath, query], {
    encoding: "utf8",
  });
  if (result.error?.code === "ENOENT") {
    throw new QaError("SQLITE3_MISSING", "The sqlite3 CLI is not on PATH; the launcher reads RealTimeX databases with it.", {
      next: "Install sqlite3 3.33 or newer (it ships with macOS), then rerun.",
    });
  }
  if (result.status !== 0) {
    throw new QaError("DB_UNREADABLE", result.stderr?.trim() || `sqlite3 exited with ${result.status} reading ${dbPath}.`, {
      next: `Check that ${dbPath} is the ${what} realtimex.db (pass --db / --packaged-db if not). If it was only locked, rerun.`,
    });
  }
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function readDevRows(ctx) {
  return queryDb(
    ctx.dbPath,
    "select id, display_name, name, config, tags, status, metadata from local_apps;",
    "Dev host",
  );
}

function tableExists(dbPath, table, what) {
  return (
    queryDb(dbPath, `select name from sqlite_master where type = 'table' and name = '${table}';`, what).length > 0
  );
}

/** Fingerprint of the installed app, or null when this machine has none. */
function readPackagedHost(ctx) {
  if (!existsSync(ctx.packagedDbPath)) return null;
  const rows = queryDb(ctx.packagedDbPath, "select id, display_name, config from local_apps;", "installed app");
  const workspaces = tableExists(ctx.packagedDbPath, "workspaces", "installed app")
    ? queryDb(ctx.packagedDbPath, "select slug from workspaces;", "installed app")
    : [];
  return { fingerprint: packagedHostFingerprint(rows, workspaces), rows };
}

function canonicalShapeProblems(ctx, rows) {
  const canonical = rows.find((row) => row.id === CANONICAL_SIGNALS_APP_ID);
  return canonicalConfigProblems(canonical, canonicalSignalsRepoRoot(SCRIPT_DIR), homedir(), {
    marketplaceDeployRoot: marketplaceDeployRoot(ctx.packagedDbPath),
  });
}

// --- Permissions ---------------------------------------------------------------------------------

// The permissions this Signals build asks RealTimeX for, from the checkout's rtx-manifest.json.
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
  if (needs.length && !requested.length) {
    throw new QaError(
      "USAGE",
      `--needs cannot be checked: ${join(worktree, "rtx-manifest.json")} lists no permissions.`,
      { next: "Run up without --needs; its output lists the permissions the app has." },
    );
  }
  const unknown = needs.filter((permission) => !requested.includes(permission));
  if (unknown.length) {
    throw new QaError(
      "USAGE",
      `--needs names permissions this Signals build does not request: ${unknown.join(", ")}. ` +
        `It requests: ${requested.join(", ")}.`,
      { next: `Rerun with --needs taken from: ${requested.join(", ")}.` },
    );
  }
  return needs;
}

// RealTimeX records the owner's answer to its permission dialog in local_apps.metadata. The CLI
// does not expose it, so it is read from the Dev database, read-only. Grants live on the row, so
// they survive down and later ups of the same slot.
function appPermissions(ctx, appId, worktree) {
  const rows = queryDb(
    ctx.dbPath,
    `select metadata from local_apps where id = '${String(appId).replace(/'/g, "''")}';`,
    "Dev host",
  );
  if (!rows.length) {
    throw new QaError("DB_UNREADABLE", `${ctx.dbPath} has no local_apps row for app ${appId}.`, {
      next: "Pass --db for the RealTimeX Dev host this app runs on.",
    });
  }
  let decided = {};
  try {
    decided = JSON.parse(rows[0].metadata || "{}")?.permissions || {};
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

// Only the owner can grant, so up waits for their decision on the dialog and stops early once a
// needed permission is denied.
async function waitForNeeds(ctx, appId, worktree, needs, pollMs) {
  const deadline = Date.now() + positiveInt(process.env.SIGNALS_QA_PERMISSION_WAIT_MS, PERMISSION_WAIT_MS);
  for (;;) {
    const permissions = appPermissions(ctx, appId, worktree);
    const denied = needs.filter((permission) => permissions.denied.includes(permission));
    const missing = needs.filter(
      (permission) => !permissions.granted.includes(permission) && !denied.includes(permission),
    );
    if ((!missing.length && !denied.length) || denied.length || Date.now() >= deadline) {
      return { permissions, missing, denied };
    }
    await sleep(pollMs);
  }
}

// --- Locks, ports, health ------------------------------------------------------------------------

function acquireSlotLock(slot, paths, action) {
  mkdirSync(dirname(paths.lockPath), { recursive: true, mode: 0o700 });
  try {
    return acquireLockFile(paths.lockPath, action);
  } catch (error) {
    if (!(error instanceof IssueLockBusyError)) throw error;
    throw new QaError("SLOT_LOCKED", `${error.message} One up, down, or remove runs per slot at a time.`, {
      // The holder record comes from a file anyone can write; spread it first so it cannot
      // overwrite the path and reason this run determined.
      lock: { ...(error.holder ?? {}), path: paths.lockPath, reason: error.reason, slot },
      next:
        error.reason === "unreadable"
          ? `Rerun after 30 s; if it persists, inspect ${paths.lockPath} before removing it.`
          : "Wait for that run to finish, then rerun.",
    });
  }
}

// Next 16 holds <dir>/.next/dev/lock for as long as `next dev` runs there and refuses a second
// dev server in the same directory.
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
  return { lockPath, pid, port: Number(info.port) || null, appUrl: info.appUrl ?? null };
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

/** The first port from the checkout's candidate that no row pins and nothing listens on. */
async function allocatePort(worktree, devRows) {
  const taken = new Set(devRows.flatMap((row) => pinnedPorts(row)));
  const start = Number.parseInt(worktreeHash(worktree).slice(0, 8), 16) % PORT_RANGE_SIZE;
  for (let offset = 0; offset < PORT_RANGE_SIZE; offset += 1) {
    const port = PORT_RANGE_START + ((start + offset) % PORT_RANGE_SIZE);
    if (RESERVED_PORTS.includes(port) || taken.has(port)) continue;
    if (await portAnswers(port, 300)) continue;
    return port;
  }
  throw new QaError(
    "PROVISION_FAILED",
    `Every port in ${PORT_RANGE_START}-${PORT_RANGE_START + PORT_RANGE_SIZE - 1} is pinned or in use.`,
    { next: "Run prune --apply to free stale slots, then rerun up." },
  );
}

async function probeHealth(port, timeoutMs) {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { url, status: response.status, ok: response.ok, body };
  } catch (error) {
    return { url, status: null, ok: false, body: null, error: error.cause?.code || error.name || String(error) };
  }
}

/** What /api/health must say about a Dev app (ADR-541-5). */
function instanceProblems(body, dataDir) {
  const instance = body?.instance;
  if (!instance) {
    return ["/api/health has no instance block, so this build predates the #541 dev-instance guard"];
  }
  const problems = [];
  if (instance.kind !== "dev") problems.push(`instance.kind is ${instance.kind}, not dev`);
  if (instance.externalEffects !== "denied") {
    problems.push(`instance.externalEffects is ${instance.externalEffects}, not denied`);
  }
  if (instance.scheduler !== "disabled") problems.push(`instance.scheduler is ${instance.scheduler}, not disabled`);
  if (resolve(String(instance.dataDir || "")) !== resolve(dataDir)) {
    problems.push(`instance.dataDir is ${instance.dataDir}, not ${dataDir}`);
  }
  return problems;
}

async function waitUntilServing(appId, ctx, { timeoutMs, pollMs, worktree, port }) {
  const deadline = Date.now() + timeoutMs;
  let runtime = null;
  let health = null;
  let sawRunning = false;
  let stoppedSince = null;
  while (Date.now() < deadline) {
    runtime = runtimeOf(cli(["get-local-app-status", appId], ctx));
    const status = String(runtime?.status || "unknown");
    if (FAILED_STATUSES.has(status)) {
      throw new QaError("START_FAILED", `The Dev app reported ${status} while starting.`, {
        runtime,
        logs: recentLogs(appId, ctx),
      });
    }
    if (status === "running") {
      sawRunning = true;
      stoppedSince = null;
      const bound = liveNextDevLock(worktree)?.port ?? null;
      const reported = Number(runtime?.runningPort) || null;
      const actual = [bound, reported].find((candidate) => candidate && candidate !== port);
      if (actual) {
        throw new QaError("PORT_MISMATCH", `The Dev app was pinned to ${port} but serves on ${actual}.`, {
          runtime,
          pinnedPort: port,
          boundPort: actual,
        });
      }
      const remaining = Math.max(1000, Math.min(30_000, deadline - Date.now()));
      health = await probeHealth(port, remaining);
      if (health.ok) return { runtime, health, port };
    } else if (status === "stopped") {
      stoppedSince ??= Date.now();
      if (sawRunning || Date.now() - stoppedSince > STOPPED_GRACE_MS) {
        throw new QaError(
          "START_FAILED",
          sawRunning ? "The Dev app stopped after it started." : "The Dev app never left the stopped state.",
          { runtime, logs: recentLogs(appId, ctx) },
        );
      }
    }
    await sleep(pollMs);
  }
  throw new QaError(
    sawRunning ? "HEALTH_TIMEOUT" : "START_TIMEOUT",
    sawRunning
      ? `The Dev app runs, but http://127.0.0.1:${port}/api/health did not return 200 within ${timeoutMs} ms.`
      : `The Dev app did not reach running within ${timeoutMs} ms.`,
    { runtime, health, logs: recentLogs(appId, ctx) },
  );
}

// --- Stale slots and prune plans -----------------------------------------------------------------

function slotTag(row) {
  return rowTags(row).find((tag) => tag.startsWith("slot-"))?.slice(5) ?? null;
}

function devDataDirOf(row) {
  const dataDir = rowConfig(row).env?.SIGNALS_DATA_DIR;
  if (!dataDir) return null;
  const root = signalsDevRoot();
  const resolved = resolve(dataDir);
  return dirname(resolved) === root ? resolved : null;
}

/**
 * Apps and slots whose checkout no longer exists, and (with legacy) the pre-#541 per-issue QA
 * apps. Anything that points at the real Signals data is never planned for deletion.
 */
function buildPrunePlan(devRows, { legacy = false } = {}) {
  const items = [];
  const skipped = [];
  const planned = new Set();
  for (const row of devRows) {
    const config = rowConfig(row);
    const isLegacy = legacy && legacyQaIssueId(row);
    if (!isDevRow(row) && !isLegacy) continue;
    if (pointsAtRealSignalsData(config.env?.SIGNALS_DATA_DIR) || row.id === CANONICAL_SIGNALS_APP_ID) {
      skipped.push({ appId: row.id, displayName: row.display_name, reason: "points at the real Signals data" });
      continue;
    }
    if (isDevRow(row)) {
      const worktree = config.env?.SIGNALS_DEV_WORKTREE ?? null;
      if (worktree && existsSync(worktree)) continue;
      items.push({
        kind: "dev-app",
        appId: row.id,
        displayName: row.display_name,
        slot: slotTag(row),
        worktree,
        dataDir: devDataDirOf(row),
      });
      planned.add(row.id);
      continue;
    }
    const issueId = legacyQaIssueId(row);
    let dataDir = null;
    let dataLeftInPlace = null;
    if (config.env?.SIGNALS_DATA_DIR) {
      try {
        dataDir = assertSafeQaDataDir(config.env.SIGNALS_DATA_DIR);
      } catch {
        dataLeftInPlace = config.env.SIGNALS_DATA_DIR;
      }
    }
    items.push({
      kind: "legacy-qa",
      appId: row.id,
      displayName: row.display_name,
      issueId,
      worktree: config.env?.SIGNALS_QA_WORKTREE ?? config.working_dir ?? null,
      dataDir: dataDir && existsSync(dataDir) ? dataDir : null,
      ...(dataLeftInPlace ? { dataLeftInPlace } : {}),
      stateFiles: legacyQaStatePaths(issueId).filter((path) => existsSync(path)),
    });
    planned.add(row.id);
  }
  for (const entry of listSlotReceipts()) {
    const receipt = entry.receipt;
    if (!receipt?.worktree || existsSync(receipt.worktree)) continue;
    const existing = items.find((item) => item.kind === "dev-app" && item.appId === receipt.appId);
    if (existing) {
      existing.dataDir ??= entry.dataDir;
      existing.slot ??= entry.slot;
      continue;
    }
    const row = devRows.find((candidate) => candidate.id === receipt.appId);
    items.push({
      kind: "slot",
      appId: row && isDevRow(row) && !planned.has(row.id) ? row.id : null,
      displayName: receipt.displayName,
      slot: entry.slot,
      worktree: receipt.worktree,
      dataDir: entry.dataDir,
    });
  }
  return { items, skipped };
}

function staleSummary(devRows) {
  const { items } = buildPrunePlan(devRows, { legacy: true });
  const count = (kind) => items.filter((item) => item.kind === kind).length;
  const stale = { devApps: count("dev-app"), slots: count("slot"), legacyQaApps: count("legacy-qa") };
  return { ...stale, total: stale.devApps + stale.slots + stale.legacyQaApps };
}

function packagedCheck(ctx, session, failures, warnings) {
  if (!session?.packaged) {
    warnings.push("No installed-app snapshot from up for this slot, so the installed app was not diffed.");
    return { packagedHostUnchanged: null };
  }
  const now = readPackagedHost(ctx);
  if (!now) {
    warnings.push(`The installed app database ${ctx.packagedDbPath} is gone, so it was not diffed.`);
    return { packagedHostUnchanged: null };
  }
  const diff = diffPackagedHost(session.packaged, now.fingerprint);
  warnings.push(...diff.warnings);
  if (!diff.unchanged) failures.push("PACKAGED_HOST_CHANGED");
  const canonicalBefore = session.packaged.rows.some((row) => row.id === CANONICAL_SIGNALS_APP_ID);
  const canonicalProblems = canonicalBefore ? canonicalShapeProblems(ctx, now.rows) : [];
  if (canonicalProblems.length) failures.push("CANONICAL_CHANGED");
  return {
    packagedHostUnchanged: diff.unchanged,
    ...(diff.unchanged ? {} : { packagedHostDiff: { added: diff.added, removed: diff.removed, changed: diff.changed } }),
    ...(canonicalProblems.length ? { canonicalProblems } : {}),
  };
}

function finish(result, failures, nexts) {
  if (!failures.length) return { ...result, ok: true };
  const errorCode = failures[0];
  return { ...result, ok: false, errorCode, failures, error: nexts[errorCode].error, next: nexts[errorCode].next };
}

function checkNexts(rerun) {
  return {
    PORT_STILL_BOUND: {
      error: "The Dev app's port still answers after the app was stopped.",
      next: `Find the listener with lsof -iTCP:<port> -sTCP:LISTEN, stop it if QA started it, then rerun: ${rerun}`,
    },
    DEV_HOST_UNSAFE: {
      error: "A Dev host Local App points at the real Signals data or pins port 3010.",
      next: devHostUnsafeNext(),
    },
    PACKAGED_HOST_CHANGED: {
      error: "The installed RealTimeX app's Local Apps changed while this slot was up.",
      next: "Stop and tell the owner: nothing in this launcher touches the installed app. Do not undo it yourself.",
    },
    CANONICAL_CHANGED: {
      error: "The canonical Signals record on the installed app no longer has its expected shape.",
      next: "This is an incident: stop and tell the owner. Never run --restore-canonical against the installed app.",
    },
    CLEANUP_FAILED: {
      error: "The Dev app could not be deleted.",
      next: `Resolve the cause above, then rerun: ${rerun}`,
    },
  };
}

function devHostUnsafeNext() {
  return (
    "A Dev host row still points at the real Signals data or the canonical port. Do not edit it here: " +
    `the slice-1 migration (node ${shellQuote(MIGRATE)}) fixes the legacy Signals row after its Delegate ` +
    "approval; tell the owner about any other row."
  );
}

// --- Commands ------------------------------------------------------------------------------------

async function up(flags) {
  const checkout = resolveCheckout(flags);
  const ctx = hostContext(flags);
  const issueId = normalizeOptionalIssueId(flags.get("issue"));
  const loopId = flags.get("loop-id") || null;
  const requestedProfile = flags.get("profile") || null;
  if (requestedProfile && !PROFILES.has(requestedProfile)) {
    throw new QaError("USAGE", `--profile must be empty or snapshot; received ${requestedProfile}.`, {
      next: "Rerun with --profile empty (the default) or --profile snapshot.",
    });
  }
  const needs = parseNeeds(flags, checkout.path);
  const waitOptions = {
    timeoutMs: positiveInt(flags.get("timeout-ms"), DEFAULT_TIMEOUT_MS),
    pollMs: positiveInt(process.env.SIGNALS_QA_POLL_MS, 1000),
  };
  const slot = resolveSlot(checkout);
  const paths = slotPaths(slot);

  const apps = listApps(ctx);
  const devRows = readDevRows(ctx);
  const unsafe = devHostProblems(devRows);
  if (unsafe.length) {
    throw new QaError("DEV_HOST_UNSAFE", `The Dev host is not safe for Signals Dev apps: ${unsafe.join("; ")}.`, {
      problems: unsafe,
      next: devHostUnsafeNext(),
    });
  }

  const release = acquireSlotLock(slot, paths, "up");
  try {
    let receipt = readJsonFile(paths.receiptPath);
    const priorSession = readJsonFile(paths.sessionPath);
    const profile = requestedProfile || receipt?.profile || "empty";
    const removeCmd = followUp("remove", checkout, ctx);
    const downCmd = followUp("down", checkout, ctx);
    let app = null;

    if (receipt) {
      if (requestedProfile && receipt.profile !== requestedProfile) {
        throw new QaError(
          "PROFILE_MISMATCH",
          `Slot ${slot} was created with --profile ${receipt.profile}; this run asked for ${requestedProfile}.`,
          { next: `${removeCmd}, then rerun up --profile ${requestedProfile}.` },
        );
      }
      app = apps.find((candidate) => candidate.id === receipt.appId) ?? null;
      if (!app) {
        throw new QaError(
          "SLOT_ORPHANED",
          `${paths.receiptPath} records app ${receipt.appId}, which no longer exists on the Dev host.`,
          { receipt, next: `${followUp("remove", checkout, ctx, { keepData: true })}, then rerun up.` },
        );
      }
      const problems = slotAppProblems(app, receipt);
      if (problems.length) {
        throw new QaError("APP_UNSAFE", `Refusing app ${app.id}: ${problems.join("; ")}.`, {
          next: "Neither up nor down will touch that app. Tell the owner; do not change it by hand.",
        });
      }
    } else {
      const taken = apps.filter(
        (candidate) =>
          appDisplayName(candidate) === devAppDisplayName(slot) ||
          (Array.isArray(candidate.tags) && candidate.tags.includes("dev") && candidate.tags.includes(`slot-${slot}`)),
      );
      if (taken.length) {
        throw new QaError(
          "NAME_TAKEN",
          `${devAppDisplayName(slot)} already exists without a receipt for this checkout: ${taken.map((candidate) => candidate.id).join(", ")}.`,
          { next: `node ${shellQuote(SELF)} prune, then prune --apply if it lists that app.` },
        );
      }
    }

    const warnings = [];
    let packaged = priorSession?.packaged ?? null;
    if (!packaged) {
      const host = readPackagedHost(ctx);
      if (host) packaged = host.fingerprint;
      else warnings.push(`No installed-app database at ${ctx.packagedDbPath}; down cannot diff it.`);
    }
    const session = {
      schemaVersion: 2,
      kind: "signals-dev-local-app-session",
      slot,
      packagedDbPath: ctx.packagedDbPath,
      packaged,
      capturedAt: priorSession?.capturedAt ?? new Date().toISOString(),
      lastHealth: priorSession?.lastHealth ?? null,
    };
    writePrivateJson(paths.sessionPath, session);

    let reused = Boolean(receipt);
    if (!receipt) {
      const lock = liveNextDevLock(checkout.path);
      if (lock) {
        throw new QaError(
          "NEXT_DEV_ALREADY_RUNNING",
          `next dev (pid ${lock.pid}${lock.appUrl ? `, ${lock.appUrl}` : ""}) already holds ${lock.lockPath}. ` +
            "Next 16 allows one dev server per directory, so the Dev app would crash during startup.",
          { lock, next: `Stop that server (kill ${lock.pid}) if you started it, then rerun up.` },
        );
      }
      const port = await allocatePort(checkout.path, devRows);
      const data = prepareSlotData({ dataDir: paths.dataDir, profile });
      const tags = devAppTags({ slot, worktree: checkout.path, issueId, loopId });
      let created;
      try {
        created = appFromCliPayload(
          cli(buildDevCreateCliArgs({ slot, worktree: checkout.path, port, dataDir: paths.dataDir, tags }), ctx),
        );
      } catch (error) {
        if (error instanceof QaError && error.errorCode === "HOST_ERROR") {
          throw new QaError("PROVISION_FAILED", error.message, { next: `${removeCmd}, then rerun up.` });
        }
        throw error;
      }
      if (!created?.id || created.id === CANONICAL_SIGNALS_APP_ID) {
        throw new QaError("PROVISION_FAILED", `create-local-app returned ${created?.id ?? "no app id"}.`, {
          next: `${removeCmd}, then rerun up.`,
        });
      }
      const now = new Date().toISOString();
      receipt = {
        schemaVersion: 2,
        kind: "signals-dev-local-app",
        slot,
        worktree: checkout.path,
        branch: checkout.branch,
        issueId,
        loopId,
        appId: created.id,
        displayName: devAppDisplayName(slot),
        tags,
        port,
        dataDir: paths.dataDir,
        profile,
        copied: data.copied,
        workspaceSlug: devWorkspaceSlug(slot),
        baseUrl: DEV_HOST_BASE_URL,
        cli: ctx.cli || null,
        dbPath: ctx.dbPath,
        createdAt: now,
        lastUpAt: null,
      };
      writePrivateJson(paths.receiptPath, receipt);
      app = listApps(ctx).find((candidate) => candidate.id === created.id) ?? null;
      const problems = app ? slotAppProblems(app, receipt) : ["it is missing after creation"];
      if (problems.length) {
        throw new QaError("APP_UNSAFE", `The new app ${created.id} does not match its receipt: ${problems.join("; ")}.`, {
          next: "Tell the owner; do not change it by hand.",
        });
      }
    }

    const refreshReceipt = (extra = {}) => {
      receipt = {
        ...receipt,
        branch: checkout.branch,
        issueId: issueId ?? receipt.issueId ?? null,
        loopId: loopId ?? receipt.loopId ?? null,
        cli: ctx.cli || receipt.cli || null,
        dbPath: ctx.dbPath,
        ...extra,
      };
      writePrivateJson(paths.receiptPath, receipt);
    };
    recordHostContext(ctx);

    const base = {
      action: "up",
      slot,
      appId: receipt.appId,
      displayName: receipt.displayName,
      worktree: checkout.path,
      primary: checkout.primary,
      branch: checkout.branch,
      port: receipt.port,
      dashboardUrl: `http://127.0.0.1:${receipt.port}/dashboard`,
      dataDir: receipt.dataDir,
      profile: receipt.profile,
      workspaceSlug: receipt.workspaceSlug,
      receiptPath: paths.receiptPath,
      reused,
    };

    if (flags.has("no-start")) {
      refreshReceipt();
      return { ok: true, ...base, started: false, warnings, next: followUp("up", checkout, ctx) };
    }

    const port = receipt.port;
    let served;
    try {
      if (appStatus(app) !== "running") {
        const lock = liveNextDevLock(checkout.path);
        if (lock) {
          throw new QaError(
            "NEXT_DEV_ALREADY_RUNNING",
            `next dev (pid ${lock.pid}) already holds ${lock.lockPath}; the Dev app would crash during startup.`,
            { lock, next: `Stop that server (kill ${lock.pid}) if you started it, then rerun up.` },
          );
        }
        if (await portAnswers(port)) {
          throw new QaError("PORT_MISMATCH", `Port ${port}, pinned for ${receipt.displayName}, is already in use.`, {
            pinnedPort: port,
            next: `Find the listener with lsof -iTCP:${port} -sTCP:LISTEN and stop it if you started it, then rerun up.`,
          });
        }
        cli(["start-local-app", receipt.appId], ctx);
      }
      served = await waitUntilServing(receipt.appId, ctx, { ...waitOptions, worktree: checkout.path, port });
    } catch (error) {
      if (error instanceof QaError && !error.extra.next) {
        if (error.errorCode === "PORT_MISMATCH") {
          try {
            stopApp(receipt.appId, ctx);
          } catch {
            // reported through next
          }
          error.extra.next = `Free port ${port} (lsof -iTCP:${port} -sTCP:LISTEN), then rerun up.`;
        } else {
          error.extra.next = `Read the logs above, then ${downCmd} before retrying up.`;
        }
      }
      throw error;
    }

    const unguarded = instanceProblems(served.health.body, receipt.dataDir);
    if (unguarded.length) {
      let stopped = false;
      try {
        stopApp(receipt.appId, ctx);
        stopped = true;
      } catch {
        stopped = false;
      }
      throw new QaError("INSTANCE_UNGUARDED", `The Dev app is not running as a guarded dev instance: ${unguarded.join("; ")}.`, {
        problems: unguarded,
        stopped,
        health: served.health.body,
        next: "Merge main into this branch (Signals Dev apps need the #541 dev-instance guard), then rerun up.",
      });
    }

    writePrivateJson(paths.sessionPath, { ...session, lastHealth: { at: new Date().toISOString(), body: served.health.body } });

    let permissions;
    if (!needs.length) {
      permissions = appPermissions(ctx, receipt.appId, checkout.path);
    } else {
      const outcome = await waitForNeeds(ctx, receipt.appId, checkout.path, needs, waitOptions.pollMs);
      permissions = outcome.permissions;
      if (outcome.missing.length || outcome.denied.length) {
        refreshReceipt({ lastUpAt: new Date().toISOString() });
        const problems = [
          ...(outcome.missing.length ? [`has not been granted ${outcome.missing.join(", ")}`] : []),
          ...(outcome.denied.length ? [`was denied ${outcome.denied.join(", ")} by the owner`] : []),
        ];
        throw new QaError(
          "PERMISSIONS_MISSING",
          `${receipt.displayName} ${problems.join(" and ")}. Agents cannot grant RealTimeX permissions.`,
          {
            permissions,
            missing: outcome.missing,
            denied: outcome.denied,
            next:
              `Ask the owner to grant ${[...outcome.missing, ...outcome.denied].join(", ")} to ` +
              `"${receipt.displayName}" in RealTimeX Dev ` +
              (outcome.denied.length
                ? "(Settings → Local Apps, where a denied permission can be changed)"
                : "(its permission dialog, or Settings → Local Apps)") +
              `, then rerun: ${followUp("up", checkout, ctx, { needs })}`,
          },
        );
      }
    }

    refreshReceipt({ lastUpAt: new Date().toISOString() });
    return {
      ok: true,
      ...base,
      started: true,
      healthUrl: served.health.url,
      instance: served.health.body?.instance ?? null,
      permissions,
      staleSlots: staleSummary(readDevRows(ctx)),
      warnings,
      next: downCmd,
    };
  } finally {
    release();
  }
}

async function status(flags) {
  const checkout = resolveCheckout(flags);
  const ctx = hostContext(flags);
  const slot = resolveSlot(checkout);
  const paths = slotPaths(slot);
  const receipt = readJsonFile(paths.receiptPath);
  const apps = listApps(ctx);
  const devRows = readDevRows(ctx);
  const app = receipt ? apps.find((candidate) => candidate.id === receipt.appId) ?? null : null;
  let runtime = null;
  let health = null;
  if (app) {
    runtime = runtimeOf(cli(["get-local-app-status", app.id], ctx));
    if (runtime?.status === "running") health = await probeHealth(receipt.port, 5000);
  }
  return {
    ok: true,
    action: "status",
    slot,
    worktree: checkout.path,
    branch: checkout.branch,
    present: Boolean(app),
    orphaned: Boolean(receipt && !app),
    appId: receipt?.appId ?? null,
    displayName: receipt?.displayName ?? devAppDisplayName(slot),
    status: runtime?.status ?? null,
    port: receipt?.port ?? null,
    healthy: Boolean(health?.ok),
    instance: health?.body?.instance ?? null,
    instanceProblems: health?.ok ? instanceProblems(health.body, receipt.dataDir) : null,
    permissions: app ? appPermissions(ctx, app.id, checkout.path) : null,
    dashboardUrl: receipt ? `http://127.0.0.1:${receipt.port}/dashboard` : null,
    dataDir: receipt?.dataDir ?? null,
    profile: receipt?.profile ?? null,
    receiptPath: receipt ? paths.receiptPath : null,
    devHostProblems: devHostProblems(devRows),
    staleSlots: staleSummary(devRows),
  };
}

async function stopAndRelease(receipt, ctx, apps, pollMs) {
  const app = receipt ? apps.find((candidate) => candidate.id === receipt.appId) ?? null : null;
  let stopped = false;
  if (app && !["stopped", "disabled", ""].includes(appStatus(app))) {
    stopApp(app.id, ctx);
    stopped = true;
  }
  const releaseWaitMs = positiveInt(process.env.SIGNALS_QA_PORT_RELEASE_MS, PORT_RELEASE_MS);
  const portReleased = receipt?.port ? await waitPortReleased(receipt.port, releaseWaitMs, pollMs) : null;
  return { app, stopped, portReleased };
}

async function down(flags) {
  const checkout = resolveCheckout(flags);
  const ctx = hostContext(flags);
  const slot = resolveSlot(checkout);
  const paths = slotPaths(slot);
  const pollMs = positiveInt(process.env.SIGNALS_QA_POLL_MS, 1000);
  const release = acquireSlotLock(slot, paths, "down");
  try {
    const receipt = readJsonFile(paths.receiptPath);
    const session = readJsonFile(paths.sessionPath);
    const failures = [];
    const warnings = [];
    if (!receipt) warnings.push(`No receipt for slot ${slot}; there was no Dev app to stop.`);
    const { app, stopped, portReleased } = await stopAndRelease(receipt, ctx, listApps(ctx), pollMs);
    if (portReleased === false) failures.push("PORT_STILL_BOUND");
    const unsafe = devHostProblems(readDevRows(ctx));
    if (unsafe.length) failures.push("DEV_HOST_UNSAFE");
    const packaged = packagedCheck(ctx, session, failures, warnings);
    if (!failures.length) rmSync(paths.sessionPath, { force: true });
    return finish(
      {
        action: "down",
        slot,
        worktree: checkout.path,
        appId: receipt?.appId ?? null,
        present: Boolean(app),
        stopped,
        port: receipt?.port ?? null,
        portReleased,
        devHostProblems: unsafe,
        ...packaged,
        kept: receipt ? { app: Boolean(app), dataDir: receipt.dataDir, receiptPath: paths.receiptPath } : null,
        warnings,
        nextOnLoopClose: receipt ? followUp("remove", checkout, ctx) : null,
      },
      failures,
      checkNexts(followUp("down", checkout, ctx)),
    );
  } finally {
    release();
  }
}

async function remove(flags) {
  const checkout = resolveCheckout(flags);
  const ctx = hostContext(flags);
  const slot = resolveSlot(checkout);
  const paths = slotPaths(slot);
  const keepData = flags.has("keep-data");
  const pollMs = positiveInt(process.env.SIGNALS_QA_POLL_MS, 1000);
  const rerun = followUp("remove", checkout, ctx, { keepData });
  const release = acquireSlotLock(slot, paths, "remove");
  try {
    const receipt = readJsonFile(paths.receiptPath);
    const session = readJsonFile(paths.sessionPath);
    const apps = listApps(ctx);
    const devRows = readDevRows(ctx);
    const failures = [];
    const warnings = [];
    let appDeleted = false;
    const app = receipt ? apps.find((candidate) => candidate.id === receipt.appId) ?? null : null;
    if (app) {
      const row = devRows.find((candidate) => candidate.id === app.id);
      const problems = [
        ...slotAppProblems(app, receipt),
        ...(row && pointsAtRealSignalsData(rowConfig(row).env?.SIGNALS_DATA_DIR) ? ["it points at the real Signals data"] : []),
      ];
      if (problems.length) {
        throw new QaError("APP_UNSAFE", `Refusing to delete app ${app.id}: ${problems.join("; ")}.`, {
          next: "Tell the owner; do not delete it by hand.",
        });
      }
    } else if (!receipt) {
      const strays = apps.filter(
        (candidate) => Array.isArray(candidate.tags) && candidate.tags.includes("dev") && candidate.tags.includes(`slot-${slot}`),
      );
      if (strays.length) {
        throw new QaError("NAME_TAKEN", `Slot ${slot} has app(s) ${strays.map((candidate) => candidate.id).join(", ")} but no receipt.`, {
          next: `node ${shellQuote(SELF)} prune, then prune --apply if it lists them.`,
        });
      }
    }
    const { portReleased } = await stopAndRelease(receipt, ctx, apps, pollMs);
    if (portReleased === false) failures.push("PORT_STILL_BOUND");
    if (app) {
      cli(["delete-local-app", app.id, "--confirm-destructive", "true", "--ignore-missing"], ctx);
      if (listApps(ctx).some((candidate) => candidate.id === app.id)) failures.push("CLEANUP_FAILED");
      else appDeleted = true;
    } else if (receipt) {
      warnings.push(`App ${receipt.appId} was already gone from the Dev host.`);
    }
    let dataRemoved = false;
    if (!failures.includes("CLEANUP_FAILED")) {
      if (!keepData && existsSync(paths.dataDir) && !pointsAtRealSignalsData(paths.dataDir)) {
        rmSync(paths.dataDir, { recursive: true, force: true });
        dataRemoved = true;
      } else {
        rmSync(paths.receiptPath, { force: true });
        rmSync(paths.sessionPath, { force: true });
      }
    }
    const leftovers = tableExists(ctx.dbPath, "workspaces", "Dev host")
      ? queryDb(ctx.dbPath, `select slug from workspaces where slug = '${devWorkspaceSlug(slot)}';`, "Dev host").map((row) => row.slug)
      : [];
    if (leftovers.length) {
      warnings.push(`The Dev host keeps workspace ${leftovers.join(", ")} and its threads; remove does not delete them.`);
    }
    const unsafe = devHostProblems(readDevRows(ctx));
    if (unsafe.length) failures.push("DEV_HOST_UNSAFE");
    const packaged = packagedCheck(ctx, session, failures, warnings);
    return finish(
      {
        action: "remove",
        slot,
        worktree: checkout.path,
        appId: receipt?.appId ?? null,
        appDeleted,
        dataDir: paths.dataDir,
        dataRemoved,
        keepData,
        portReleased,
        devHostProblems: unsafe,
        ...packaged,
        warnings,
      },
      failures,
      checkNexts(rerun),
    );
  } finally {
    release();
  }
}

async function prune(flags) {
  const ctx = hostContext(flags);
  const legacy = flags.has("legacy-qa");
  const devRows = readDevRows(ctx);
  const { items, skipped } = buildPrunePlan(devRows, { legacy });
  const applyCmd = `node ${shellQuote(SELF)} prune --apply${legacy ? " --legacy-qa" : ""}${ctx.cli ? ` --cli ${shellQuote(ctx.cli)}` : ""} --db ${shellQuote(ctx.dbPath)}`;
  if (!flags.has("apply")) {
    return {
      ok: true,
      action: "prune",
      applied: false,
      legacyQa: legacy,
      plan: items,
      skipped,
      next: items.length ? applyCmd : null,
    };
  }
  const apps = listApps(ctx);
  const removed = [];
  const failed = [];
  for (const item of items) {
    const paths = item.slot ? slotPaths(item.slot) : null;
    let release = () => {};
    if (paths) {
      try {
        release = acquireSlotLock(item.slot, paths, "prune");
      } catch (error) {
        failed.push({ ...item, reason: error.message });
        continue;
      }
    }
    try {
      if (item.appId) {
        const app = apps.find((candidate) => candidate.id === item.appId);
        if (app) {
          if (!["stopped", "disabled", ""].includes(appStatus(app))) stopApp(app.id, ctx);
          cli(["delete-local-app", app.id, "--confirm-destructive", "true", "--ignore-missing"], ctx);
          if (listApps(ctx).some((candidate) => candidate.id === app.id)) {
            failed.push({ ...item, reason: "still listed after delete" });
            continue;
          }
        }
      }
      if (item.dataDir && !pointsAtRealSignalsData(item.dataDir)) {
        rmSync(item.dataDir, { recursive: true, force: true });
      }
      for (const path of item.stateFiles ?? []) rmSync(path, { force: true });
      removed.push(item);
    } catch (error) {
      failed.push({ ...item, reason: error.message });
    } finally {
      release();
    }
  }
  const result = { action: "prune", applied: true, legacyQa: legacy, removed, failed, skipped };
  if (!failed.length) return { ok: true, ...result };
  return {
    ok: false,
    ...result,
    errorCode: "CLEANUP_FAILED",
    error: `${failed.length} item(s) could not be removed.`,
    next: `Resolve the reasons listed in failed, then rerun: ${applyCmd}`,
  };
}

const COMMANDS = { up, status, down, remove, prune };

const [command, ...rest] = process.argv.slice(2);
const action = command || "help";
try {
  if (!command || command === "--help" || command === "help") {
    console.log(usage());
    process.exit(command ? 0 : 2);
  }
  if (!COMMANDS[command]) {
    throw new QaError("USAGE", `Unknown command ${command}.\n\n${usage()}`, {
      next: "Use up, status, down, remove, or prune.",
    });
  }
  let flags;
  try {
    flags = parseFlagArgs(rest);
  } catch (error) {
    throw new QaError("USAGE", error.message, { next: "Check the arguments against --help and rerun." });
  }
  if (flags.has("help")) {
    console.log(usage());
    process.exit(0);
  }
  const result = await COMMANDS[command](flags);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.stderr.write(`qa-local-app ${action}: ${result.errorCode}: ${result.error}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  const coded =
    error instanceof QaError
      ? error
      : new QaError("UNEXPECTED", error?.message || String(error), {
          next: "Check the arguments against --help and rerun; report the error if it repeats.",
        });
  const result = { ok: false, action, errorCode: coded.errorCode, error: coded.message, ...coded.extra };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`qa-local-app ${action}: ${coded.errorCode}: ${coded.message}\n`);
  process.exit(coded.errorCode === "USAGE" ? 2 : 1);
}
