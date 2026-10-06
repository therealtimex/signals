import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const CANONICAL_SIGNALS_APP_ID = "47e45f71-3279-42f5-8e95-731de01b6eae";
export const CANONICAL_SIGNALS_DISPLAY_NAME = "Signals";
export const DEFAULT_DEV_CLI_BASE_URL = "http://127.0.0.1:3101/cli";

export function qaTemporaryRoot(platform = process.platform, systemTmpDir = tmpdir()) {
  return platform === "darwin" ? `${sep}private${sep}tmp` : resolve(systemTmpDir);
}

const QA_TEMP_ROOT = qaTemporaryRoot();
const QA_DATA_PREFIX = `${QA_TEMP_ROOT}${sep}signals-qa-`;

export function normalizeIssueId(value) {
  const issueId = String(value ?? "").trim().replace(/^#/, "");
  if (!/^\d+$/.test(issueId)) {
    throw new Error("--issue must be a numeric issue id.");
  }
  return issueId;
}

// Before #541 each QA app was "Signals issue-<N> QA" with data under <platform temp>/signals-qa-*
// and a receipt next to it. qa-local-app.mjs prune --legacy-qa still recognises those.
export function qaAppDisplayName(issueId) {
  return `Signals issue-${normalizeIssueId(issueId)} QA`;
}

export function qaReceiptPath(issueId) {
  return join(QA_TEMP_ROOT, `signals-qa-local-app-issue-${normalizeIssueId(issueId)}.json`);
}

export function legacyQaStatePaths(issueId) {
  const id = normalizeIssueId(issueId);
  return [
    qaReceiptPath(id),
    join(QA_TEMP_ROOT, `signals-qa-local-app-issue-${id}.session.json`),
    join(QA_TEMP_ROOT, `signals-qa-local-app-issue-${id}.lock`),
  ];
}

export function assertSafeQaDataDir(dataDir) {
  const resolved = resolve(String(dataDir || ""));
  if (!resolved.startsWith(QA_DATA_PREFIX) || resolved === QA_DATA_PREFIX.slice(0, -1)) {
    throw new Error(
      `QA data directory must be an absolute ${QA_DATA_PREFIX}* path; received ${resolved}.`,
    );
  }
  return resolved;
}

export function canonicalSignalsRepoRoot(fromDir = process.cwd()) {
  const resolvedFromDir = realpathSync(resolve(fromDir));
  const result = spawnSync(
    "git",
    ["-C", resolvedFromDir, "rev-parse", "--git-common-dir"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || `Could not resolve the Signals repository from ${resolvedFromDir}.`,
    );
  }
  const commonDir = result.stdout.trim();
  const absoluteCommonDir = commonDir.startsWith(sep)
    ? resolve(commonDir)
    : resolve(resolvedFromDir, commonDir);
  return dirname(absoluteCommonDir);
}

export function parseCliJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) throw new Error("realtimex-pp-cli returned no JSON output.");
  const start = text.indexOf("{");
  if (start === -1) throw new Error(`realtimex-pp-cli returned non-JSON output: ${text}`);
  return JSON.parse(text.slice(start));
}

function operationBody(payload) {
  return payload?.results ?? payload?.result ?? payload?.data ?? payload;
}

export function appsFromCliPayload(payload) {
  const body = operationBody(payload);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.apps)) return body.apps;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

export function appFromCliPayload(payload) {
  const body = operationBody(payload);
  return body?.app ?? body?.localApp ?? (body?.id ? body : null);
}

export function appDisplayName(app) {
  return String(app?.displayName ?? app?.display_name ?? "").trim();
}

// The environment variables realtimex-pp-cli authenticates with (2.0.38). Each one belongs to the
// RealTimeX host that issued it; the scoped key a --cli wrapper adds with --credential-ref is the
// only credential meant for another host.
export const REALTIMEX_AUTH_ENV_KEYS = Object.freeze([
  "REALTIMEX_TERMINAL_SESSION_TOKEN",
  "REALTIMEX_APP_ID_AUTH",
  "REALTIMEX_CONFIG",
]);

/** `http://localhost:3101/cli/` and `http://127.0.0.1:3101/cli` name the same host. */
export function normalizeRealtimeXBaseUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.protocol}//${host}:${port}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return text.replace(/\/+$/, "");
  }
}

/**
 * The child env for one CLI call. The terminal's own credentials (REALTIMEX_AUTH_ENV_KEYS) travel
 * only to the host that issued them, the terminal's REALTIMEX_BASE_URL, and never alongside an
 * explicit credential wrapper, so the wrapper's --credential-ref is the only credential in play.
 * An unknown issuer counts as a different host.
 */
export function realtimeXCliEnv(baseUrl, env = process.env, { explicitCredential = false } = {}) {
  const child = { ...env, REALTIMEX_BASE_URL: baseUrl };
  const issuer = normalizeRealtimeXBaseUrl(env.REALTIMEX_BASE_URL);
  if (explicitCredential || !issuer || issuer !== normalizeRealtimeXBaseUrl(baseUrl)) {
    for (const key of REALTIMEX_AUTH_ENV_KEYS) delete child[key];
  }
  return child;
}

export function runRealtimeXCli(args, options = {}) {
  const cli = options.cli || process.env.REALTIMEX_PP_CLI?.trim() || "realtimex-pp-cli";
  const baseUrl = options.baseUrl || DEFAULT_DEV_CLI_BASE_URL;
  const result = spawnSync(cli, [...args, "--agent", "--compact=false"], {
    encoding: "utf8",
    env: realtimeXCliEnv(baseUrl, process.env, { explicitCredential: Boolean(options.cli) }),
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        result.error?.message ||
        `${cli} exited with ${result.status}.`,
    );
  }
  return parseCliJson(result.stdout);
}

export function parseFlagArgs(argv) {
  const values = new Map();
  const booleans = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    if (
      ["--no-start", "--keep-data", "--help", "--apply", "--legacy-qa", "--plan", "--accept-packaged-change"].includes(arg)
    ) {
      booleans.add(arg.slice(2));
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  return {
    has: (name) => booleans.has(name),
    get: (name, fallback = "") => values.get(name) ?? fallback,
  };
}

// The dev host stores the literal `~/.signals`; the packaged host stores the expanded path.
// Both name the same directory, so both are canonical.
export function isCanonicalSignalsDataDir(value, home = homedir()) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (text === "~/.signals") return true;
  return isAbsolute(text) && resolve(text) === resolve(home, ".signals");
}

export function realtimexDbPath(storageRoot, env = process.env) {
  const userData =
    env.REALTIMEX_USER_DATA?.trim() || join(homedir(), ".realtimex.ai", "desktop-user-data");
  const user = env.REALTIMEX_USER?.trim() || "trungle_rta_vn";
  return join(userData, storageRoot, "users", user, "storage", "realtimex.db");
}

const MARKETPLACE_DEPLOY_DIR = /^signals-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Where RealTimeX unpacks marketplace installs: `<storage>/marketplace-deploy`, next to its database. */
export function marketplaceDeployRoot(dbPath) {
  return join(dirname(resolve(dbPath)), "marketplace-deploy");
}

/**
 * The canonical app runs from the main checkout or, once Signals is installed from the marketplace,
 * from that install's `<marketplace-deploy>/signals-<version>` directory (#535). Both are the user's
 * own app; a worktree or any other path is neither.
 */
export function isCanonicalWorkingDir(workingDir, canonicalRepoRoot, deployRoot = null) {
  const text = String(workingDir ?? "").trim();
  if (!text || !isAbsolute(text)) return false;
  const resolved = resolve(text);
  if (resolved === resolve(canonicalRepoRoot)) return true;
  return (
    Boolean(deployRoot) &&
    dirname(resolved) === resolve(deployRoot) &&
    MARKETPLACE_DEPLOY_DIR.test(basename(resolved))
  );
}

export function canonicalConfigProblems(
  row,
  canonicalRepoRoot,
  home = homedir(),
  { marketplaceDeployRoot: deployRoot = null } = {},
) {
  const problems = [];
  if (!row) return ["canonical Signals Local App record is missing"];
  if (row.id !== CANONICAL_SIGNALS_APP_ID) problems.push("canonical id does not match");
  if (String(row.display_name || "") !== CANONICAL_SIGNALS_DISPLAY_NAME) {
    problems.push("canonical display name does not match");
  }

  let config;
  try {
    config = typeof row.config === "string" ? JSON.parse(row.config) : row.config;
  } catch {
    return [...problems, "canonical config is not valid JSON"];
  }
  if (!isCanonicalSignalsDataDir(config?.env?.SIGNALS_DATA_DIR, home)) {
    problems.push("canonical SIGNALS_DATA_DIR is not ~/.signals");
  }

  const expectedRoot = resolve(canonicalRepoRoot);
  if (!isCanonicalWorkingDir(config?.working_dir, expectedRoot, deployRoot)) {
    problems.push(
      deployRoot
        ? `canonical working_dir is neither ${expectedRoot} nor a Signals marketplace deploy under ${resolve(deployRoot)}`
        : `canonical working_dir is not ${expectedRoot}`,
    );
  }
  const executableText = [config?.command, ...(Array.isArray(config?.args) ? config.args : [])]
    .filter(Boolean)
    .join(" ");
  if (executableText.includes(`${sep}worktrees${sep}`) || executableText.includes("signals-qa-")) {
    problems.push("canonical command or args reference ephemeral QA state");
  }
  return problems;
}
