#!/usr/bin/env node
/**
 * INCIDENT RECOVERY ONLY: restore the canonical dev Signals Local App in the
 * RealTimeX SQLite database. Normal QA must create an issue-scoped app with
 * provision-signals-qa-local-app.mjs and must never call this script.
 *
 * Usage:
 *   node scripts/qa/provision-signals-local-app.mjs --restore-canonical \
 *     [--db /path/to/realtimex.db]
 *
 * Without --db or RTX_DB_PATH, recovery targets only the dev database under
 * desktop-user-data/dev. Non-dev automatic storage roots are rejected.
 *
 * Environment:
 *   RTX_DB_PATH          Override database path
 *   REALTIMEX_USER_DATA  Base user data dir (default: ~/.realtimex.ai/desktop-user-data)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIGNALS_NODE_MODULE_ABI,
  SIGNALS_NODE_VERSION_WITH_PREFIX,
} from "../node-runtime-contract.mjs";
import { canonicalSignalsRepoRoot } from "./signals-qa-local-app.mjs";

if (!process.argv.includes("--restore-canonical")) {
  console.error("Refusing to update the canonical Signals Local App without --restore-canonical.");
  console.error(
    "Normal QA must use scripts/qa/provision-signals-qa-local-app.mjs instead.",
  );
  process.exit(2);
}

const SIGNALS_APP_ID = "47e45f71-3279-42f5-8e95-731de01b6eae";
const SIGNALS_PERMISSIONS = [
  "credentials.list",
  "credentials.use",
  "webhook.trigger",
  "llm.embed",
  "llm.chat",
  "desktop.browser",
  "desktop.runtime-sessions",
];
const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = canonicalSignalsRepoRoot(SCRIPT_REPO_ROOT);
const configuredNodeVersion =
  process.env.REALTIMEX_NPX_NODE_VERSION?.trim() ||
  SIGNALS_NODE_VERSION_WITH_PREFIX;
const MANAGED_NODE_VERSION = configuredNodeVersion.startsWith("v")
  ? configuredNodeVersion
  : `v${configuredNodeVersion}`;

function inspectNodeExecutable(executable) {
  const result = spawnSync(
    executable,
    [
      "-p",
      "JSON.stringify({ version: process.version, moduleAbi: process.versions.modules })",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return {
      error:
        result.stderr?.trim() ||
        result.error?.message ||
        `exited with ${result.status}`,
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: `returned invalid runtime metadata: ${result.stdout.trim()}` };
  }
}

function resolveManagedNodeExecutable() {
  if (MANAGED_NODE_VERSION !== SIGNALS_NODE_VERSION_WITH_PREFIX) {
    throw new Error(
      `Signals requires managed Node ${SIGNALS_NODE_VERSION_WITH_PREFIX}; received ${MANAGED_NODE_VERSION}.`,
    );
  }

  const candidates = [
    process.env.REALTIMEX_NODE_PATH?.trim(),
    join(homedir(), ".nvm", "versions", "node", MANAGED_NODE_VERSION, "bin", "node"),
    join(
      homedir(),
      ".realtimex.ai",
      ".nvm",
      "versions",
      "node",
      MANAGED_NODE_VERSION,
      "bin",
      "node",
    ),
    process.execPath,
  ].filter(Boolean);
  const mismatches = [];

  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) continue;
    const runtime = inspectNodeExecutable(candidate);
    if (
      runtime.version === SIGNALS_NODE_VERSION_WITH_PREFIX &&
      runtime.moduleAbi === SIGNALS_NODE_MODULE_ABI
    ) {
      return candidate;
    }
    mismatches.push(
      `${candidate} (${runtime.error || `${runtime.version}, ABI ${runtime.moduleAbi}`})`,
    );
  }

  throw new Error(
    `Managed Node ${SIGNALS_NODE_VERSION_WITH_PREFIX} with module ABI ${SIGNALS_NODE_MODULE_ABI} was not found. Install it via nvm or set REALTIMEX_NODE_PATH.${mismatches.length ? ` Checked: ${mismatches.join("; ")}` : ""}`,
  );
}

function parseDbArg() {
  const idx = process.argv.indexOf("--db");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  if (process.env.RTX_DB_PATH?.trim()) {
    return process.env.RTX_DB_PATH.trim();
  }
  const userData =
    process.env.REALTIMEX_USER_DATA?.trim() ||
    join(homedir(), ".realtimex.ai", "desktop-user-data");
  const userSegment = process.env.REALTIMEX_USER?.trim() || "trungle_rta_vn";
  const storageRoot = process.env.REALTIMEX_STORAGE_ROOT?.trim();
  const runtime = process.env.REALTIMEX_RUNTIME?.trim();
  if ((storageRoot && storageRoot !== "dev") || (runtime && runtime !== "dev")) {
    throw new Error(
      "Canonical Signals recovery defaults to dev storage. Pass --db or RTX_DB_PATH to target another database explicitly.",
    );
  }
  return join(userData, "dev", "users", userSegment, "storage", "realtimex.db");
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSqlite(dbPath, sql) {
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 failed (${result.status})`);
  }
  return result.stdout.trim();
}

if (process.argv.includes("--deploy-instructions")) {
  console.log("Settings → Plugins → Signals → Deploy the workspace provision.");
  console.log("For Local App source QA, run this script again without --deploy-instructions.");
  process.exit(0);
}

const nodeExecutable = resolveManagedNodeExecutable();
const nodeBinDir = dirname(nodeExecutable);

const dbPath = parseDbArg();
if (!existsSync(dbPath)) {
  console.error(`RTX database not found: ${dbPath}`);
  console.error("Pass --db /path/to/realtimex.db or set RTX_DB_PATH.");
  process.exit(1);
}

const storageRoot =
  process.env.REALTIMEX_STORAGE_ROOT?.trim() ||
  (process.env.REALTIMEX_RUNTIME === "dev" ? "dev" : "app");
const resolvedDbPath = resolve(dbPath);
const dbStorageRoot = resolvedDbPath.includes(`${sep}dev${sep}users${sep}`)
  ? "dev"
  : resolvedDbPath.includes(`${sep}app${sep}users${sep}`)
    ? "app"
    : null;
const targetsDevStorage = (dbStorageRoot || storageRoot) === "dev";
const rtxServerPort = targetsDevStorage ? "3101" : "3001";
const rtxBaseUrl = `http://127.0.0.1:${rtxServerPort}/cli`;

const npmExecutable = join(
  nodeBinDir,
  process.platform === "win32" ? "npm.cmd" : "npm"
);

const devQaPort =
  process.env.SIGNALS_DEV_PORT?.trim() ||
  process.env.RTX_PORT?.trim() ||
  "3010";

const config = JSON.stringify({
  // Use npm run dev so RTX-injected RTX_PORT is honored via package.json.
  // Passing "-p", "{port}" in args fails when RTX does not substitute argv placeholders.
  command: npmExecutable,
  args: ["run", "dev"],
  working_dir: REPO_ROOT,
  // Pin dev QA port so RTX, workspace briefs, and resolve-base-url.sh stay aligned.
  port: Number(devQaPort),
  home_url: `http://localhost:${devQaPort}/dashboard`,
  env: {
    HOSTNAME: "127.0.0.1",
    PORT: devQaPort,
    SIGNALS_DATA_DIR: "~/.signals",
    REALTIMEX_BASE_URL: rtxBaseUrl,
    // Keep Turbopack and child processes on the same ABI as better-sqlite3.
    PATH: `${nodeBinDir}${delimiter}${process.env.PATH || ""}`,
  },
});

const metadata = JSON.stringify({
  permissions: {
    granted: SIGNALS_PERMISSIONS,
    denied: [],
  },
});

const existing = runSqlite(
  dbPath,
  `SELECT id FROM local_apps WHERE id = ${sqlQuote(SIGNALS_APP_ID)};`
);

if (existing) {
  runSqlite(
    dbPath,
    `UPDATE local_apps SET
      display_name = 'Signals',
      name = 'signals',
      description = 'Local-first social GTM and relationship knowledge graph',
      app_type = 'node',
      config = ${sqlQuote(config)},
      metadata = ${sqlQuote(metadata)},
      enabled = 1,
      status = 'stopped',
      is_configured = 1,
      updatedAt = datetime('now')
    WHERE id = ${sqlQuote(SIGNALS_APP_ID)};`
  );
  console.log(`Updated Signals Local App ${SIGNALS_APP_ID} in ${dbPath}`);
} else {
  runSqlite(
    dbPath,
    `INSERT INTO local_apps (
      id, display_name, name, description, app_type, config, metadata,
      enabled, status, is_configured, createdAt, updatedAt
    ) VALUES (
      ${sqlQuote(SIGNALS_APP_ID)},
      'Signals',
      'signals',
      'Local-first social GTM and relationship knowledge graph',
      'node',
      ${sqlQuote(config)},
      ${sqlQuote(metadata)},
      1,
      'stopped',
      1,
      datetime('now'),
      datetime('now')
    );`
  );
  console.log(`Created Signals Local App ${SIGNALS_APP_ID} in ${dbPath}`);
}

const verify = runSqlite(
  dbPath,
  `SELECT id, display_name FROM local_apps WHERE id = ${sqlQuote(SIGNALS_APP_ID)};`
);
console.log(`Verified row: ${verify}`);
console.log("Pre-granted permissions:", SIGNALS_PERMISSIONS.join(", "));
console.log("");
console.log("Next: package and upload agent skills to the signals workspace:");
console.log("  bash scripts/package-realtimex-signals-skill.sh /tmp/realtimex-signals.zip");
console.log("  bash scripts/package-signals-publish-skill.sh /tmp/signals-publish.zip");
console.log("  node scripts/test-signals-publish-skill-package.mjs");
console.log("");
console.log("Then upload each zip via:");
console.log("  curl -X POST http://127.0.0.1:3101/api/workspace/signals/agent-skills \\");
console.log("    -F zip_file=@/tmp/realtimex-signals.zip -F type=zip -F display_name='RealtimeX Signals' -F name=realtimex-signals");
console.log("  curl -X POST http://127.0.0.1:3101/api/workspace/signals/agent-skills \\");
console.log("    -F zip_file=@/tmp/signals-publish.zip -F type=zip -F display_name='Signals Publish' -F name=signals-publish");
