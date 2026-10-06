#!/usr/bin/env node
/**
 * Signals Local App hygiene (ADR-541-7). qa-local-app.mjs runs the same checks itself; this CLI
 * exposes them for loop gates and incident checks. Every database is opened read-only.
 *
 *   --dev-db       Dev host invariant: no Local App points at the real Signals data (~/.signals)
 *                  or pins the canonical port 3010.
 *   --packaged-db  Installed app: the canonical Signals record keeps its shape; with --snapshot
 *                  <slot session.json> (written by qa-local-app up) its Local Apps are diffed too.
 *   --issue        Legacy (pre-#541): no "Signals issue-<N> QA" record remains in --db.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  CANONICAL_SIGNALS_APP_ID,
  canonicalConfigProblems,
  canonicalSignalsRepoRoot,
  marketplaceDeployRoot,
  normalizeIssueId,
  parseFlagArgs,
  qaAppDisplayName,
} from "./signals-qa-local-app.mjs";
import {
  devHostProblems,
  diffPackagedHost,
  packagedHostFingerprint,
  rowTags,
} from "./signals-dev-local-app.mjs";

function readRows(dbPath, query) {
  if (!existsSync(dbPath)) throw new Error(`RealTimeX database not found: ${dbPath}`);
  const result = spawnSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", dbPath, query], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `sqlite3 exited with ${result.status} reading ${dbPath}.`);
  }
  return JSON.parse(result.stdout || "[]");
}

function usage() {
  console.log(`Usage:
  node scripts/qa/verify-signals-local-app-hygiene.mjs [--dev-db <dev realtimex.db>] \\
    [--packaged-db <installed realtimex.db> [--snapshot <slot session.json>]] \\
    [--canonical-repo /path/to/signals] [--issue <N> --db <realtimex.db>]

--dev-db       Fails when a Dev host Local App sets SIGNALS_DATA_DIR to ~/.signals (any spelling)
               or pins port 3010. Until the slice-1 migration runs this fails by design.
--packaged-db  Fails when the installed app's canonical Signals record (${CANONICAL_SIGNALS_APP_ID})
               no longer runs from the canonical checkout or a Signals marketplace deploy with
               ~/.signals. With --snapshot, also fails when Local Apps were added, removed, or
               reconfigured since that snapshot.
--issue        Legacy: fails while a "Signals issue-<N> QA" record remains in --db.
At least one mode is required. Prints one JSON object; exit 0 only when no problem was found.`);
}

try {
  const flags = parseFlagArgs(process.argv.slice(2));
  if (flags.has("help")) {
    usage();
    process.exit(0);
  }
  const devDb = flags.get("dev-db");
  const packagedDb = flags.get("packaged-db");
  const issue = flags.get("issue");
  if (!devDb && !packagedDb && !issue) {
    usage();
    process.exit(2);
  }

  const problems = [];
  const warnings = [];
  const report = { ok: true };

  if (devDb) {
    const rows = readRows(resolve(devDb), "select id, display_name, config from local_apps;");
    const unsafe = devHostProblems(rows);
    problems.push(...unsafe);
    report.devHost = { dbPath: resolve(devDb), problems: unsafe };
  }

  if (packagedDb) {
    const dbPath = resolve(packagedDb);
    const rows = readRows(dbPath, "select id, display_name, config from local_apps;");
    const canonical = rows.find((row) => row.id === CANONICAL_SIGNALS_APP_ID);
    const canonicalRepoRoot = resolve(flags.get("canonical-repo") || canonicalSignalsRepoRoot());
    const canonicalProblems = canonicalConfigProblems(canonical, canonicalRepoRoot, homedir(), {
      marketplaceDeployRoot: marketplaceDeployRoot(dbPath),
    });
    problems.push(...canonicalProblems);
    report.packagedHost = { dbPath, canonicalRepoRoot, canonicalProblems };
    const snapshotPath = flags.get("snapshot");
    if (snapshotPath) {
      const session = JSON.parse(readFileSync(resolve(snapshotPath), "utf8"));
      if (!session?.packaged) throw new Error(`${snapshotPath} holds no installed-app snapshot.`);
      const hasWorkspaces =
        readRows(dbPath, "select name from sqlite_master where type = 'table' and name = 'workspaces';").length > 0;
      const workspaces = hasWorkspaces ? readRows(dbPath, "select slug from workspaces;") : [];
      const diff = diffPackagedHost(session.packaged, packagedHostFingerprint(rows, workspaces));
      warnings.push(...diff.warnings);
      for (const row of diff.added) problems.push(`installed app gained Local App ${row.display_name} (${row.id})`);
      for (const row of diff.removed) problems.push(`installed app lost Local App ${row.display_name} (${row.id})`);
      for (const row of diff.changed) problems.push(`installed app Local App ${row.display_name} (${row.id}) changed`);
      report.packagedHost.unchanged = diff.unchanged;
    }
  }

  if (issue) {
    const issueId = normalizeIssueId(issue);
    const dbPath = resolve(flags.get("db") || devDb || packagedDb || "");
    const rows = readRows(dbPath, "select id, display_name, tags from local_apps;");
    const leftovers = rows.filter(
      (row) =>
        row.display_name === qaAppDisplayName(issueId) ||
        (rowTags(row).includes("qa") && rowTags(row).includes(`issue-${issueId}`)),
    );
    if (leftovers.length) {
      problems.push(
        `${leftovers.length} issue-specific QA Local App record(s) still exist: ${leftovers.map((row) => row.id).join(", ")}`,
      );
    }
    report.legacyIssue = { issueId, dbPath, remaining: leftovers.length };
  }

  report.ok = problems.length === 0;
  report.problems = problems;
  report.warnings = warnings;
  console.log(JSON.stringify(report, null, 2));
  if (problems.length) {
    console.error("Signals Local App hygiene check failed:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`Signals Local App hygiene verification failed: ${error.message}`);
  process.exit(1);
}
