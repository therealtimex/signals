#!/usr/bin/env node
/**
 * Upsert the canonical dev Signals Local App into the RealTimeX SQLite database.
 * DEV / QA FALLBACK — production uses marketplace bundle + platform #1614 install.
 * Required before embedded-mode QA when /sdk/register returns "App not found".
 *
 * Usage:
 *   node scripts/qa/provision-signals-local-app.mjs [--db /path/to/realtimex.db]
 *
 * Environment:
 *   RTX_DB_PATH          Override database path
 *   REALTIMEX_USER_DATA  Base user data dir (default: ~/.realtimex.ai/desktop-user-data)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
  return join(userData, "app", "users", userSegment, "storage", "realtimex.db");
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

const config = JSON.stringify({
  command: process.execPath,
  args: [
    join(REPO_ROOT, "node_modules/next/dist/bin/next"),
    "dev",
    "-p",
    "{port}",
  ],
  working_dir: REPO_ROOT,
  home_url: "http://localhost:{port}/dashboard",
});

const metadata = JSON.stringify({
  permissions: {
    granted: SIGNALS_PERMISSIONS,
    denied: [],
  },
});

const dbPath = parseDbArg();
if (!existsSync(dbPath)) {
  console.error(`RTX database not found: ${dbPath}`);
  console.error("Pass --db /path/to/realtimex.db or set RTX_DB_PATH.");
  process.exit(1);
}

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
