#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  CANONICAL_SIGNALS_APP_ID,
  canonicalSignalsRepoRoot,
  canonicalConfigProblems,
  normalizeIssueId,
  parseFlagArgs,
  qaAppDisplayName,
} from "./signals-qa-local-app.mjs";

function defaultDbPath() {
  if (process.env.RTX_DB_PATH?.trim()) return process.env.RTX_DB_PATH.trim();
  const userData =
    process.env.REALTIMEX_USER_DATA?.trim() ||
    join(homedir(), ".realtimex.ai", "desktop-user-data");
  const user = process.env.REALTIMEX_USER?.trim() || "trungle_rta_vn";
  const storageRoot =
    process.env.REALTIMEX_STORAGE_ROOT?.trim() ||
    (process.env.REALTIMEX_RUNTIME === "dev" ? "dev" : "app");
  return join(userData, storageRoot, "users", user, "storage", "realtimex.db");
}

function defaultCanonicalRepoRoot() {
  return canonicalSignalsRepoRoot();
}

function readRows(dbPath) {
  const query = "SELECT id, display_name, name, config, tags, status FROM local_apps;";
  const result = spawnSync("sqlite3", ["-json", dbPath, query], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `sqlite3 exited with ${result.status}.`);
  }
  return JSON.parse(result.stdout || "[]");
}

try {
  const flags = parseFlagArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log(`Usage:
  node scripts/qa/verify-signals-local-app-hygiene.mjs --issue <number> \\
    [--db /path/to/realtimex.db] [--canonical-repo /path/to/signals]

Loop-close gate: the canonical Signals app must use ~/.signals and the canonical checkout,
and the issue-specific QA Local App record must no longer exist.`);
    process.exit(0);
  }

  const issueId = normalizeIssueId(flags.get("issue"));
  const dbPath = resolve(flags.get("db") || defaultDbPath());
  if (!existsSync(dbPath)) throw new Error(`RealtimeX database not found: ${dbPath}`);
  const canonicalRepoRoot = resolve(flags.get("canonical-repo") || defaultCanonicalRepoRoot());
  const rows = readRows(dbPath);
  const canonical = rows.find((row) => row.id === CANONICAL_SIGNALS_APP_ID);
  const issueTag = `issue-${issueId}`;
  const issueApps = rows.filter((row) => {
    let tags = [];
    try {
      tags = Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || "[]");
    } catch {
      tags = [];
    }
    return (
      row.display_name === qaAppDisplayName(issueId) ||
      (tags.includes("qa") && tags.includes(issueTag))
    );
  });
  const problems = canonicalConfigProblems(canonical, canonicalRepoRoot);
  if (issueApps.length) {
    problems.push(
      `${issueApps.length} issue-specific QA Local App record(s) still exist: ${issueApps
        .map((row) => row.id)
        .join(", ")}`,
    );
  }

  if (problems.length) {
    console.error("Signals Local App hygiene check failed:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        issueId,
        dbPath,
        canonicalAppId: CANONICAL_SIGNALS_APP_ID,
        canonicalRepoRoot,
        issueQaAppsRemaining: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`Signals Local App hygiene verification failed: ${error.message}`);
  process.exit(1);
}
