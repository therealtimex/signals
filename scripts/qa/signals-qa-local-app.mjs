import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_SIGNALS_APP_ID = "47e45f71-3279-42f5-8e95-731de01b6eae";
export const CANONICAL_SIGNALS_DISPLAY_NAME = "Signals";
export const DEFAULT_DEV_CLI_BASE_URL = "http://127.0.0.1:3101/cli";

const QA_DATA_PREFIX = `${sep}private${sep}tmp${sep}signals-qa-`;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export function normalizeIssueId(value) {
  const issueId = String(value ?? "").trim().replace(/^#/, "");
  if (!/^\d+$/.test(issueId)) {
    throw new Error("--issue must be a numeric issue id.");
  }
  return issueId;
}

export function qaAppDisplayName(issueId) {
  return `Signals issue-${normalizeIssueId(issueId)} QA`;
}

export function qaAppTags(issueId, loopId = "") {
  const tags = ["signals", "qa", "ephemeral", `issue-${normalizeIssueId(issueId)}`];
  const normalizedLoopId = String(loopId).trim();
  if (normalizedLoopId) {
    tags.push(normalizedLoopId.startsWith("loop-") ? normalizedLoopId : `loop-${normalizedLoopId}`);
  }
  return tags;
}

export function defaultQaDataDir(issueId) {
  return `/private/tmp/signals-qa-issue-${normalizeIssueId(issueId)}-data`;
}

export function qaReceiptPath(issueId) {
  return `/private/tmp/signals-qa-local-app-issue-${normalizeIssueId(issueId)}.json`;
}

export function qaLauncherDir() {
  return join(SCRIPT_DIR, "signals-qa-local-app-launcher");
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

export function assertSafeQaDataDir(dataDir) {
  const resolved = resolve(String(dataDir || ""));
  if (!resolved.startsWith(QA_DATA_PREFIX) || resolved === QA_DATA_PREFIX.slice(0, -1)) {
    throw new Error(
      `QA data directory must be an absolute /private/tmp/signals-qa-* path; received ${resolved}.`,
    );
  }
  return resolved;
}

export function assertSignalsIssueWorktree(worktree) {
  const resolved = realpathSync(resolve(String(worktree || "")));
  const packagePath = join(resolved, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(`Signals worktree has no package.json: ${resolved}`);
  }
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageJson.name !== "@realtimex/signals") {
    throw new Error(`Expected @realtimex/signals at ${resolved}.`);
  }

  const branchResult = spawnSync("git", ["-C", resolved, "branch", "--show-current"], {
    encoding: "utf8",
  });
  if (branchResult.status !== 0) {
    throw new Error(branchResult.stderr?.trim() || `Could not inspect worktree ${resolved}.`);
  }
  const branch = branchResult.stdout.trim();
  if (["main", "master"].includes(branch)) {
    throw new Error(
      `QA requires an issue worktree, not the canonical ${branch} checkout (${resolved}).`,
    );
  }

  const worktreeResult = spawnSync(
    "git",
    ["-C", resolved, "rev-parse", "--git-dir", "--git-common-dir"],
    { encoding: "utf8" },
  );
  if (worktreeResult.status !== 0) {
    throw new Error(worktreeResult.stderr?.trim() || `Could not inspect git metadata for ${resolved}.`);
  }
  const [gitDirValue, commonDirValue] = worktreeResult.stdout.trim().split(/\r?\n/);
  const resolveGitPath = (value) => (value.startsWith(sep) ? resolve(value) : resolve(resolved, value));
  if (resolveGitPath(gitDirValue) === resolveGitPath(commonDirValue)) {
    throw new Error(`QA requires a linked issue worktree, not the primary checkout (${resolved}).`);
  }
  return { branch, path: resolved };
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

export function findIssueQaApps(apps, issueId) {
  const displayName = qaAppDisplayName(issueId);
  const issueTag = `issue-${normalizeIssueId(issueId)}`;
  return apps.filter((app) => {
    const tags = Array.isArray(app?.tags) ? app.tags : [];
    return appDisplayName(app) === displayName || (tags.includes("qa") && tags.includes(issueTag));
  });
}

export function assertSafeQaApp(app, issueId) {
  if (!app?.id) throw new Error("QA Local App has no id.");
  if (app.id === CANONICAL_SIGNALS_APP_ID) {
    throw new Error("Refusing to mutate the canonical Signals Local App.");
  }
  const expectedName = qaAppDisplayName(issueId);
  if (appDisplayName(app) !== expectedName) {
    throw new Error(`Refusing Local App ${app.id}: expected display name ${expectedName}.`);
  }
  const tags = Array.isArray(app.tags) ? app.tags : [];
  for (const required of qaAppTags(issueId)) {
    if (!tags.includes(required)) {
      throw new Error(`Refusing Local App ${app.id}: missing safety tag ${required}.`);
    }
  }
  return app;
}

export function buildQaCreateCliArgs({ issueId, worktree, dataDir, loopId = "", baseUrl }) {
  const normalizedIssueId = normalizeIssueId(issueId);
  const safeDataDir = assertSafeQaDataDir(dataDir);
  const nodeBinDir = dirname(process.execPath);
  const env = {
    HOSTNAME: "127.0.0.1",
    SIGNALS_DATA_DIR: safeDataDir,
    SIGNALS_QA_WORKTREE: resolve(worktree),
    REALTIMEX_BASE_URL: baseUrl || DEFAULT_DEV_CLI_BASE_URL,
    PATH: `${nodeBinDir}${delimiter}${process.env.PATH || ""}`,
  };
  return [
    "create-local-app",
    "--display-name",
    qaAppDisplayName(normalizedIssueId),
    "--description",
    `Signals issue-${normalizedIssueId} isolated QA Local App`,
    "--source-type",
    "source",
    "--source-path",
    qaLauncherDir(),
    "--env",
    JSON.stringify(env),
    "--home-url",
    "http://localhost:{port}/dashboard",
    "--tags",
    qaAppTags(normalizedIssueId, loopId).join(","),
  ];
}

export function runRealtimeXCli(args, options = {}) {
  const cli = options.cli || process.env.REALTIMEX_PP_CLI?.trim() || "realtimex-pp-cli";
  const baseUrl = options.baseUrl || DEFAULT_DEV_CLI_BASE_URL;
  const result = spawnSync(cli, [...args, "--agent", "--compact=false"], {
    encoding: "utf8",
    env: { ...process.env, REALTIMEX_BASE_URL: baseUrl },
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
    if (["--no-start", "--keep-data", "--help"].includes(arg)) {
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

export function canonicalConfigProblems(row, canonicalRepoRoot) {
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
  if (config?.env?.SIGNALS_DATA_DIR !== "~/.signals") {
    problems.push("canonical SIGNALS_DATA_DIR is not ~/.signals");
  }

  const expectedRoot = resolve(canonicalRepoRoot);
  if (!config?.working_dir || resolve(String(config.working_dir)) !== expectedRoot) {
    problems.push(`canonical working_dir is not ${expectedRoot}`);
  }
  const executableText = [config?.command, ...(Array.isArray(config?.args) ? config.args : [])]
    .filter(Boolean)
    .join(" ");
  if (executableText.includes(`${sep}worktrees${sep}`) || executableText.includes("signals-qa-")) {
    problems.push("canonical command or args reference ephemeral QA state");
  }
  return problems;
}
