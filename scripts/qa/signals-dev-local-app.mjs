/**
 * Slot model for Signals Dev Local Apps (#541, specs/signals-dev-local-app.md): one RealTimeX Dev
 * Local App per Signals checkout, keyed by the checkout's realpath. qa-local-app.mjs drives it;
 * migrate-dev-signals-row.mjs and verify-signals-local-app-hygiene.mjs reuse the hygiene checks.
 *
 * Nothing here talks to the installed RealTimeX app. Its database is only ever read, read-only,
 * to prove it was left alone.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lockHolderAlive, pidAlive } from "./qa-issue-lock.mjs";
import { CANONICAL_SIGNALS_APP_ID, DEFAULT_DEV_CLI_BASE_URL } from "./signals-qa-local-app.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const DEV_HOST_BASE_URL = DEFAULT_DEV_CLI_BASE_URL;
export const PACKAGED_HOST_PORT = 3001;
export const DEV_APP_NAME_PREFIX = "Signals Dev · ";
export const PORT_RANGE_START = 3300;
export const PORT_RANGE_SIZE = 200;
// Ports a Dev app must never pin: a bare `npm run dev` (3000), the installed app (3001), the
// canonical Signals (3010), and the RealTimeX surfaces on both hosts.
export const RESERVED_PORTS = Object.freeze([
  3000, 3001, 3010, 3011, 3081, 3100, 3101, 4002, 8001, 8080, 9888,
]);
// Directories under the Dev root that are not slots.
export const NON_SLOT_ENTRIES = Object.freeze(new Set([".locks", ".launcher", "_backups"]));

export class SlotError extends Error {
  constructor(errorCode, message, extra = {}) {
    super(message);
    this.errorCode = errorCode;
    this.extra = extra;
  }
}

// --- Roots ---------------------------------------------------------------------------------------

/** The owner's real Signals data. SIGNALS_CANONICAL_DATA_DIR is a test-only override. */
export function canonicalSignalsDataDir(env = process.env) {
  const override = env.SIGNALS_CANONICAL_DATA_DIR?.trim();
  return resolve(override || join(homedir(), ".signals"));
}

function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`);
}

/** `~/.signals-dev`. SIGNALS_DEV_ROOT is a test-only override; neither may sit inside real data. */
export function signalsDevRoot(env = process.env) {
  const root = resolve(env.SIGNALS_DEV_ROOT?.trim() || join(homedir(), ".signals-dev"));
  for (const real of [canonicalSignalsDataDir(env), join(homedir(), ".signals")]) {
    if (isInside(root, real)) {
      throw new SlotError("USAGE", `The Signals Dev root ${root} is inside the real Signals data at ${real}.`, {
        next: "Unset SIGNALS_DEV_ROOT (test-only) and rerun.",
      });
    }
  }
  return root;
}

/**
 * True when a configured SIGNALS_DATA_DIR names the owner's real data: the literal `~/.signals`
 * (the Dev host stores it unexpanded), or any absolute spelling of `$HOME/.signals` or of the
 * test-only canonical override.
 */
export function pointsAtRealSignalsData(value, env = process.env) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const expanded = text.startsWith("~/") ? join(homedir(), text.slice(2)) : text;
  if (!isAbsolute(expanded)) return false;
  const target = resolve(expanded);
  return [join(homedir(), ".signals"), canonicalSignalsDataDir(env)].some(
    (real) => target === resolve(real),
  );
}

// --- Checkouts and slots -------------------------------------------------------------------------

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed in ${cwd}.`);
  }
  return result.stdout.trim();
}

/** A Signals checkout, primary or linked. Throws on anything else. */
export function resolveSignalsCheckout(path) {
  const requested = resolve(String(path || ""));
  if (!existsSync(requested)) throw new Error(`No such directory: ${requested}`);
  const worktree = realpathSync(requested);
  const packagePath = join(worktree, "package.json");
  if (!existsSync(packagePath)) throw new Error(`Not a Signals checkout (no package.json): ${worktree}`);
  let packageName = null;
  try {
    packageName = JSON.parse(readFileSync(packagePath, "utf8")).name;
  } catch {
    packageName = null;
  }
  if (packageName !== "@realtimex/signals") {
    throw new Error(`Expected @realtimex/signals at ${worktree}; found ${packageName ?? "no name"}.`);
  }
  const toplevel = realpathSync(git(worktree, ["rev-parse", "--show-toplevel"]));
  if (toplevel !== worktree) {
    throw new Error(`${worktree} is inside the checkout ${toplevel}; pass the checkout root.`);
  }
  const [gitDir, commonDir] = git(worktree, ["rev-parse", "--git-dir", "--git-common-dir"]).split(/\r?\n/);
  const absolute = (value) => (isAbsolute(value) ? resolve(value) : resolve(worktree, value));
  const primary = absolute(gitDir) === absolute(commonDir);
  const branchResult = spawnSync("git", ["-C", worktree, "branch", "--show-current"], { encoding: "utf8" });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() || null : null;
  return { path: worktree, primary, branch };
}

export function worktreeHash(worktreePath) {
  return createHash("sha256").update(resolve(worktreePath)).digest("hex");
}

export function sanitizeSlot(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `main` for the primary checkout, otherwise the worktree directory name (ADR-541-2). */
export function baseSlotFor(checkout) {
  if (checkout.primary) return "main";
  return sanitizeSlot(basename(checkout.path)) || `wt-${worktreeHash(checkout.path).slice(0, 6)}`;
}

export function devAppDisplayName(slot) {
  return `${DEV_APP_NAME_PREFIX}${slot}`;
}

export function devWorkspaceSlug(slot) {
  return `signals-dev-${slot}`;
}

export function devAppTags({ slot, worktree, issueId = null, loopId = null }) {
  const tags = ["signals", "dev", `slot-${slot}`, `worktree-${worktreeHash(worktree).slice(0, 8)}`];
  if (issueId) tags.push(`issue-${issueId}`);
  const loop = String(loopId ?? "").trim();
  if (loop) tags.push(loop.startsWith("loop-") ? loop : `loop-${loop}`);
  return tags;
}

export function normalizeOptionalIssueId(value) {
  const text = String(value ?? "").trim().replace(/^#/, "");
  if (!text) return null;
  if (!/^\d+$/.test(text)) throw new SlotError("USAGE", `--issue must be numeric; received ${value}.`, {
    next: "Pass --issue <number>, or omit it.",
  });
  return text;
}

export function slotPaths(slot, env = process.env) {
  const root = signalsDevRoot(env);
  const dataDir = join(root, slot);
  const launcherDir = join(dataDir, ".launcher");
  return {
    root,
    dataDir,
    launcherDir,
    receiptPath: join(launcherDir, "receipt.json"),
    sessionPath: join(launcherDir, "session.json"),
    lockPath: join(root, ".locks", `${slot}.lock`),
  };
}

export function hostConfigPath(env = process.env) {
  return join(signalsDevRoot(env), ".launcher", "host.json");
}

export function backupsDir(env = process.env) {
  return join(signalsDevRoot(env), "_backups");
}

export function readJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The slot for a checkout. A slot whose receipt names a different checkout belongs to that
 * checkout, so this one gets the hash-suffixed slot instead.
 */
export function resolveSlot(checkout, env = process.env) {
  const base = baseSlotFor(checkout);
  for (const slot of [base, `${base}-${worktreeHash(checkout.path).slice(0, 6)}`]) {
    const receipt = readJsonFile(slotPaths(slot, env).receiptPath);
    if (!receipt || receipt.worktree === checkout.path) return slot;
  }
  throw new SlotError(
    "NAME_TAKEN",
    `Both ${base} and its hashed variant are held by receipts for other checkouts.`,
    { next: "Run prune to clear slots whose checkout is gone, then rerun." },
  );
}

/** Every receipt under the Dev root, for stale-slot reports and prune. */
export function listSlotReceipts(env = process.env) {
  const root = signalsDevRoot(env);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_SLOT_ENTRIES.has(entry.name))
    .map((entry) => {
      const paths = slotPaths(entry.name, env);
      return { slot: entry.name, ...paths, receipt: readJsonFile(paths.receiptPath) };
    });
}

/** The receipt of the slot that serves a checkout, if any (used by app-automation flows). */
export function slotReceiptForWorktree(worktree, env = process.env) {
  let path;
  try {
    path = realpathSync(resolve(worktree));
  } catch {
    return null;
  }
  return listSlotReceipts(env).find((entry) => entry.receipt?.worktree === path)?.receipt ?? null;
}

// Next 16 holds <dir>/.next/dev/lock for as long as `next dev` runs there and refuses a second
// dev server in the same directory.
export function liveNextDevLock(worktree) {
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

/** The live holder of a slot's launcher lock, or null. */
export function slotLockHolder(paths) {
  if (!existsSync(paths.lockPath)) return null;
  const holder = readJsonFile(paths.lockPath);
  if (!holder) return { unreadable: true };
  return lockHolderAlive(holder) ? holder : null;
}

/**
 * Why `up` could not create a fresh app for this checkout right now: the slot already has a
 * receipt, an app already uses its name or slot tag, `next dev` runs in the checkout, or another
 * launcher run holds the slot. `apps` are `{ id, displayName|display_name, tags }`. The slice-1
 * migration runs this before it deletes anything (#541 Review F1).
 */
export function freshSlotBlockers({ checkout, slot, apps, env = process.env }) {
  const blockers = [];
  const paths = slotPaths(slot, env);
  if (existsSync(paths.receiptPath)) {
    const owner = readJsonFile(paths.receiptPath)?.worktree;
    blockers.push(`slot ${slot} already has a receipt (${paths.receiptPath}${owner ? `, for ${owner}` : ""})`);
  }
  const name = devAppDisplayName(slot);
  for (const app of apps) {
    const tags = Array.isArray(app.tags) ? app.tags : rowTags(app);
    if ((app.displayName ?? app.display_name) === name || (tags.includes("dev") && tags.includes(`slot-${slot}`))) {
      blockers.push(`app ${app.id} already uses the name or tag of slot ${slot}`);
    }
  }
  const lock = liveNextDevLock(checkout.path);
  if (lock) blockers.push(`next dev (pid ${lock.pid}) holds ${lock.lockPath}`);
  const holder = slotLockHolder(paths);
  if (holder) blockers.push(`another launcher run holds ${paths.lockPath}${holder.pid ? ` (pid ${holder.pid})` : ""}`);
  return blockers;
}

// --- Rows ----------------------------------------------------------------------------------------

export function parseRowJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "") ?? fallback;
  } catch {
    return fallback;
  }
}

export function rowTags(row) {
  const tags = parseRowJson(row?.tags, []);
  return Array.isArray(tags) ? tags : [];
}

export function rowConfig(row) {
  const config = parseRowJson(row?.config, {});
  return config && typeof config === "object" ? config : {};
}

export function isDevRow(row) {
  const tags = rowTags(row);
  return tags.includes("signals") && tags.includes("dev");
}

const LEGACY_QA_NAME = /^Signals issue-(\d+) QA$/;

export function legacyQaIssueId(row) {
  return String(row?.display_name ?? row?.displayName ?? "").match(LEGACY_QA_NAME)?.[1] ?? null;
}

function portFromUrl(url) {
  const match = String(url ?? "").match(/:(\d{2,5})(?:[/?#]|$)/);
  return match ? Number(match[1]) : null;
}

/** Every port a row pins: args, config.port, env.PORT, and home_url. */
export function pinnedPorts(row) {
  const config = rowConfig(row);
  const ports = new Set();
  const add = (value) => {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0) ports.add(port);
  };
  const args = Array.isArray(config.args) ? config.args.map(String) : [];
  args.forEach((arg, index) => {
    if (["-p", "--port"].includes(arg)) add(args[index + 1]);
    const inline = arg.match(/^--port=(\d+)$/);
    if (inline) add(inline[1]);
  });
  add(config.port);
  add(config.env?.PORT);
  add(portFromUrl(config.home_url));
  return [...ports];
}

/**
 * Dev-host invariant (ADR-541-7): no row may point at the real Signals data, and none may pin the
 * canonical app's port 3010.
 */
export function devHostProblems(rows, env = process.env) {
  const problems = [];
  for (const row of rows) {
    const config = rowConfig(row);
    const label = `${row.display_name ?? row.id} (${row.id})`;
    if (pointsAtRealSignalsData(config.env?.SIGNALS_DATA_DIR, env)) {
      problems.push(`${label} sets SIGNALS_DATA_DIR to the real Signals data (${config.env.SIGNALS_DATA_DIR})`);
    }
    if (pinnedPorts(row).includes(3010)) {
      problems.push(`${label} pins port 3010, the canonical Signals port`);
    }
  }
  return problems;
}

// --- Ports ---------------------------------------------------------------------------------------

/** The first free port from the worktree's deterministic candidate (ADR-541-3). */
export function choosePort(worktree, { taken = new Set(), listening = () => false } = {}) {
  const start = Number.parseInt(worktreeHash(worktree).slice(0, 8), 16) % PORT_RANGE_SIZE;
  for (let offset = 0; offset < PORT_RANGE_SIZE; offset += 1) {
    const port = PORT_RANGE_START + ((start + offset) % PORT_RANGE_SIZE);
    if (RESERVED_PORTS.includes(port) || taken.has(port) || listening(port)) continue;
    return port;
  }
  return null;
}

// --- Create arguments ----------------------------------------------------------------------------

export function devLauncherDir() {
  return join(SCRIPT_DIR, "signals-dev-local-app-launcher");
}

/** The env the launcher pins on every Dev app (ADR-541-5). Agents never choose these. */
export function devAppEnv({ slot, worktree, port, dataDir, nodeBinDir = dirname(process.execPath), path = process.env.PATH || "" }) {
  return {
    SIGNALS_INSTANCE: "dev",
    SIGNALS_SCHEDULER_ENABLED: "0",
    SIGNALS_DATA_DIR: dataDir,
    SIGNALS_RTX_WORKSPACE_SLUG: devWorkspaceSlug(slot),
    SIGNALS_DEV_WORKTREE: worktree,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    REALTIMEX_BASE_URL: DEV_HOST_BASE_URL,
    PATH: `${nodeBinDir}${delimiter}${path}`,
  };
}

export function buildDevCreateCliArgs({ slot, worktree, port, dataDir, tags }) {
  return [
    "create-local-app",
    "--display-name",
    devAppDisplayName(slot),
    "--description",
    `Signals Dev Local App for ${worktree}`,
    "--source-type",
    "source",
    "--source-path",
    devLauncherDir(),
    "--env",
    JSON.stringify(devAppEnv({ slot, worktree, port, dataDir })),
    "--home-url",
    `http://localhost:${port}/dashboard`,
    "--tags",
    tags.join(","),
  ];
}

/** The receipt-backed app is only touched while it still carries every slot tag. */
export function slotAppProblems(app, receipt) {
  const problems = [];
  if (!app?.id) return ["the app has no id"];
  if (app.id === CANONICAL_SIGNALS_APP_ID) problems.push("it is the canonical Signals app");
  const name = String(app.displayName ?? app.display_name ?? "");
  if (name !== receipt.displayName) problems.push(`its name is ${name}, not ${receipt.displayName}`);
  const tags = Array.isArray(app.tags) ? app.tags : rowTags(app);
  const safety = receipt.tags.filter(
    (tag) => tag === "signals" || tag === "dev" || /^(slot|worktree)-/.test(tag),
  );
  for (const tag of safety) {
    if (!tags.includes(tag)) problems.push(`it lost the safety tag ${tag}`);
  }
  return problems;
}

// --- Data profiles -------------------------------------------------------------------------------

function sqlite(args, options = {}) {
  const result = spawnSync("sqlite3", args, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") {
    throw new SlotError("SQLITE3_MISSING", "The sqlite3 CLI is not on PATH.", {
      next: "Install sqlite3 3.33 or newer (it ships with macOS), then rerun.",
    });
  }
  return result;
}

function assertDotCommandPath(path) {
  if (/['"\n]/.test(path)) {
    throw new SlotError("SNAPSHOT_FAILED", `Refusing a path with quotes or newlines: ${path}`, {
      next: "Use a Dev root without quotes in its path.",
    });
  }
  return path;
}

/**
 * Prepares `<dev root>/<slot>` for a new app. `empty` creates the directory and lets Signals
 * migrate on boot. `snapshot` takes a SQLite online backup of the real data.db plus media/, and
 * scrubs stored platform credentials, which would otherwise decrypt on this machine. Nothing else
 * is copied, and the real data is opened read-only.
 */
export function prepareSlotData({ dataDir, profile, env = process.env }) {
  const realData = canonicalSignalsDataDir(env);
  if (pointsAtRealSignalsData(dataDir, env) || isInside(dataDir, realData)) {
    throw new SlotError("SNAPSHOT_FAILED", `Refusing to use ${dataDir}: it is the real Signals data.`, {
      next: "Unset SIGNALS_DEV_ROOT (test-only) and rerun.",
    });
  }
  if (profile === "empty") {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    return { profile, copied: [] };
  }
  const target = join(dataDir, "data.db");
  if (existsSync(target)) {
    throw new SlotError("SLOT_DATA_EXISTS", `${target} already exists; a snapshot never overwrites slot data.`, {
      next: "Run remove for this slot to delete its data, then rerun up --profile snapshot.",
    });
  }
  const source = join(realData, "data.db");
  if (!existsSync(source)) {
    throw new SlotError("SNAPSHOT_FAILED", `There is no Signals database to snapshot at ${source}.`, {
      next: "Use --profile empty.",
    });
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const fail = (message) => {
    rmSync(partial, { force: true });
    rmSync(`${partial}-journal`, { force: true });
    throw new SlotError("SNAPSHOT_FAILED", message, {
      next: "Fix the cause, then rerun up --profile snapshot; nothing was kept.",
    });
  };
  const backup = sqlite([
    "-readonly",
    "-cmd",
    ".timeout 10000",
    source,
    `.backup '${assertDotCommandPath(partial)}'`,
  ]);
  if (backup.status !== 0) fail(backup.stderr?.trim() || `sqlite3 .backup exited with ${backup.status}.`);
  const hasAccounts = sqlite([partial, "select count(*) from sqlite_master where type = 'table' and name = 'platform_accounts';"]);
  if (hasAccounts.status !== 0) fail(hasAccounts.stderr?.trim() || "Could not inspect the snapshot.");
  if (hasAccounts.stdout.trim() === "1") {
    const scrub = sqlite([
      partial,
      "update platform_accounts set credentials_encrypted = null, status = 'needs_reauth'; " +
        "select count(*) from platform_accounts where credentials_encrypted is not null;",
    ]);
    if (scrub.status !== 0 || scrub.stdout.trim() !== "0") {
      fail(scrub.stderr?.trim() || "Stored platform credentials survived the scrub.");
    }
  }
  renameSync(partial, target);
  const copied = ["data.db"];
  const media = join(realData, "media");
  if (existsSync(media)) {
    cpSync(media, join(dataDir, "media"), { recursive: true });
    copied.push("media");
  }
  return { profile, copied };
}

// --- Installed-app snapshot ----------------------------------------------------------------------

export function configHash(config) {
  return createHash("sha256").update(String(config ?? "")).digest("hex");
}

/** Read-only fingerprint of the installed app: every Local App row and every workspace slug. */
export function packagedHostFingerprint(rows, workspaces) {
  return {
    rows: rows
      .map((row) => ({ id: row.id, display_name: row.display_name, configHash: configHash(row.config) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workspaces: [...new Set(workspaces.map((workspace) => workspace.slug))].sort(),
  };
}

/**
 * Compares the installed app now with the fingerprint `up` took. Added, removed, or reconfigured
 * Local Apps fail the check. The canonical Signals row is judged by its shape instead (a
 * marketplace update legitimately changes its config), and new `signals*` workspaces are warnings
 * because the owner may create them during the day.
 */
export function diffPackagedHost(before, after) {
  const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
  const a = byId(before.rows);
  const b = byId(after.rows);
  const added = [...b.keys()].filter((id) => !a.has(id)).map((id) => b.get(id));
  const removed = [...a.keys()].filter((id) => !b.has(id)).map((id) => a.get(id));
  const changed = [];
  const warnings = [];
  for (const [id, row] of b) {
    const prior = a.get(id);
    if (!prior) continue;
    if (prior.configHash === row.configHash && prior.display_name === row.display_name) continue;
    if (id === CANONICAL_SIGNALS_APP_ID) {
      warnings.push("The canonical Signals record changed (for example a marketplace update); its shape is checked separately.");
      continue;
    }
    changed.push(row);
  }
  const newWorkspaces = after.workspaces.filter((slug) => !before.workspaces.includes(slug));
  for (const slug of newWorkspaces.filter((candidate) => candidate.startsWith("signals"))) {
    warnings.push(`Workspace ${slug} appeared on the installed app after up; nothing in this launcher creates workspaces there.`);
  }
  return { added, removed, changed, warnings, unchanged: !added.length && !removed.length && !changed.length };
}
