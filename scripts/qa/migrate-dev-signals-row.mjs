#!/usr/bin/env node
/**
 * ONE-SHOT, slice 1 of #541 (ADR-541-6): replace the RealTimeX Dev host's legacy "Signals" Local App
 * (id 47e45f71-…, SIGNALS_DATA_DIR=~/.signals, port 3010) with "Signals Dev · main", a guarded Dev
 * app for the main checkout with its own data under ~/.signals-dev/main.
 *
 * Run it only after the Delegate judgment for exactly this effect, with the owner's scoped key:
 *
 *   node scripts/qa/migrate-dev-signals-row.mjs --plan --cli <wrapper>
 *       read-only: checks the preconditions and prints the row's Backup A sha256
 *   node scripts/qa/migrate-dev-signals-row.mjs --cli <wrapper> --expect-row-sha256 <sha256>
 *       backs up the row and the Dev database, deletes the row, unlinks its storage symlink,
 *       provisions Signals Dev · main without starting it, and verifies the result
 *
 * It never touches the installed app (its profile or port 3001), never starts the old row, never
 * recurses into the storage entry, and writes no SQL: the Dev host's own CLI deletes and creates.
 *
 * Restore (the owner's call):
 *   Row only, Dev host running:
 *     node scripts/qa/qa-local-app.mjs remove --worktree <main checkout>
 *     REALTIMEX_RUNTIME=dev node scripts/qa/provision-signals-local-app.mjs --restore-canonical --db <dev db>
 *   Whole database: stop RealTimeX Dev, replace realtimex.db with Backup B (delete realtimex.db-wal
 *   and realtimex.db-shm), start it again.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_SIGNALS_APP_ID,
  appsFromCliPayload,
  canonicalSignalsRepoRoot,
  parseFlagArgs,
  realtimexDbPath,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";
import {
  DEV_HOST_BASE_URL,
  SlotError,
  backupsDir,
  devAppDisplayName,
  devHostProblems,
  legacyQaIssueId,
  pointsAtRealSignalsData,
  rowConfig,
  rowTags,
  slotPaths,
} from "./signals-dev-local-app.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(SCRIPT_DIR, "qa-local-app.mjs");
const RESTORE = join(SCRIPT_DIR, "provision-signals-local-app.mjs");
const LEGACY_DISPLAY_NAME = "Signals";

function fail(errorCode, message, next, extra = {}) {
  throw new SlotError(errorCode, message, { next, ...extra });
}

function sqliteJson(dbPath, query) {
  const result = spawnSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", dbPath, query], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("DB_UNREADABLE", result.stderr?.trim() || `sqlite3 exited with ${result.status}.`, "Check --db and rerun.");
  }
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function cli(args, cliPath) {
  try {
    return runRealtimeXCli(args, { baseUrl: DEV_HOST_BASE_URL, cli: cliPath });
  } catch (error) {
    const message = String(error.message || error);
    if (/connection refused|ECONNREFUSED|dial tcp|i\/o timeout/i.test(message)) {
      fail("HOST_UNREACHABLE", `No RealTimeX Dev host answers at ${DEV_HOST_BASE_URL}.`, "Ask the owner to start RealTimeX Dev, then rerun.");
    }
    if (/HTTP 40[13]|scope|TERMINAL_SESSION_NOT_ACTIVE/i.test(message)) {
      fail(
        "LOCAL_APP_MANAGEMENT_REFUSED",
        "The Dev host refuses Local App management from this identity.",
        'Pass --cli <wrapper> that runs realtimex-pp-cli --credential-ref <owner scoped key> "$@".',
        { cliError: message },
      );
    }
    fail("HOST_ERROR", message, `Check the Dev host at ${DEV_HOST_BASE_URL}, then rerun.`);
  }
}

/** The Dev database path, which must be a Dev profile, never the installed app's. */
function devDbPath(flags) {
  const dbPath = resolve(flags.get("db") || realtimexDbPath("dev"));
  if (dbPath.includes(`${sep}app${sep}users${sep}`) || !dbPath.includes(`${sep}dev${sep}users${sep}`) || basename(dbPath) !== "realtimex.db") {
    fail(
      "HOST_PACKAGED_FORBIDDEN",
      `${dbPath} is not a RealTimeX Dev profile database (<user data>/dev/users/<user>/storage/realtimex.db).`,
      `Pass --db ${realtimexDbPath("dev")}.`,
    );
  }
  if (!existsSync(dbPath)) fail("DB_NOT_FOUND", `Dev database not found: ${dbPath}`, "Pass --db for the RealTimeX Dev host.");
  return dbPath;
}

function readRows(dbPath) {
  return sqliteJson(dbPath, "select id, display_name, config, tags, status from local_apps;");
}

function legacyRowBackup(dbPath) {
  const rows = sqliteJson(dbPath, `select * from local_apps where id = '${CANONICAL_SIGNALS_APP_ID}';`);
  if (!rows.length) return null;
  const text = `${JSON.stringify(rows[0], null, 2)}\n`;
  return { row: rows[0], text, sha256: createHash("sha256").update(text).digest("hex") };
}

function restoreCommands(dbPath, mainCheckout) {
  return {
    rowOnly: [
      `node ${LAUNCHER} remove --worktree ${mainCheckout} --db ${dbPath}`,
      `REALTIMEX_RUNTIME=dev node ${RESTORE} --restore-canonical --db ${dbPath}`,
    ],
    wholeDatabase:
      "Stop RealTimeX Dev, replace realtimex.db with Backup B (delete realtimex.db-wal and realtimex.db-shm), start it again.",
  };
}

function usage() {
  console.log(`Usage:
  node scripts/qa/migrate-dev-signals-row.mjs --plan [--cli <wrapper>] [--db <dev realtimex.db>]
  node scripts/qa/migrate-dev-signals-row.mjs --cli <wrapper> --expect-row-sha256 <sha256> \\
    [--db <dev realtimex.db>] [--packaged-db <installed realtimex.db>]

One-shot slice-1 migration (#541): replaces the Dev host's legacy "Signals" Local App
(${CANONICAL_SIGNALS_APP_ID}, ~/.signals, port 3010) with "${devAppDisplayName("main")}".
--plan is read-only and prints the preconditions and the row's Backup A sha256. Applying requires
that sha256, so the change runs only against the exact row that was approved. Run it only after
the Delegate judgment for this effect. See the header of this file for the restore commands.`);
}

async function main() {
  const flags = parseFlagArgs(process.argv.slice(2));
  if (flags.has("help")) {
    usage();
    return null;
  }
  const dbPath = devDbPath(flags);
  const mainCheckout = realpathSync(resolve(flags.get("main-checkout") || canonicalSignalsRepoRoot(SCRIPT_DIR)));
  const cliPath = flags.get("cli") || "";
  const rows = readRows(dbPath);
  const legacy = rows.find((row) => row.id === CANONICAL_SIGNALS_APP_ID) ?? null;
  const replacement = rows.find((row) => row.display_name === devAppDisplayName("main")) ?? null;
  const restore = restoreCommands(dbPath, mainCheckout);

  if (!legacy) {
    if (replacement) {
      return { ok: true, action: "migrate", alreadyMigrated: true, devDb: dbPath, appId: replacement.id, restore };
    }
    fail("ROW_MISSING", `The Dev host has no ${CANONICAL_SIGNALS_APP_ID} row and no ${devAppDisplayName("main")}.`, "Nothing to migrate; tell the owner.");
  }
  const config = rowConfig(legacy);
  const unexpected = [];
  if (legacy.display_name !== LEGACY_DISPLAY_NAME) unexpected.push(`display name is ${legacy.display_name}`);
  if (!pointsAtRealSignalsData(config.env?.SIGNALS_DATA_DIR)) {
    unexpected.push(`SIGNALS_DATA_DIR is ${config.env?.SIGNALS_DATA_DIR}, not ~/.signals`);
  }
  if (unexpected.length) {
    fail("ROW_UNEXPECTED", `The legacy row is not what slice 1 was approved for: ${unexpected.join("; ")}.`, "Stop and tell the owner; do not change it.");
  }
  if (replacement) {
    fail("ROW_UNEXPECTED", `${devAppDisplayName("main")} (${replacement.id}) already exists next to the legacy row.`, "Stop and tell the owner.");
  }
  // Every other row must already satisfy the Dev-host invariant: the replacement is provisioned by
  // the launcher, which refuses an unsafe host, and that must not be found out after the delete.
  const blockers = devHostProblems(rows.filter((row) => row.id !== CANONICAL_SIGNALS_APP_ID));
  const pruneFirst = `node ${LAUNCHER} prune --legacy-qa --apply --cli <wrapper> --db ${dbPath}`;
  const backup = legacyRowBackup(dbPath);
  const storageLink = join(dirname(dbPath), "local-apps", CANONICAL_SIGNALS_APP_ID);
  let runtimeStatus = null;
  if (cliPath || !flags.has("plan")) {
    const payload = cli(["get-local-app-status", CANONICAL_SIGNALS_APP_ID], cliPath);
    const body = payload?.results ?? payload;
    runtimeStatus = body?.runtime?.status ?? null;
    if (runtimeStatus && runtimeStatus !== "stopped") {
      fail("ROW_RUNNING", `The legacy row is ${runtimeStatus}; this script never stops it.`, "Ask the owner to stop it in RealTimeX Dev, then rerun.");
    }
  }
  const steps = [
    `Backup A: the row as JSON (sha256 ${backup.sha256}) into ${backupsDir()}`,
    `Backup B: sqlite3 .backup of ${dbPath} into ${backupsDir()}`,
    `delete-local-app ${CANONICAL_SIGNALS_APP_ID} --confirm-destructive true on ${DEV_HOST_BASE_URL}`,
    `unlink ${storageLink} only if it is a symlink to ${mainCheckout}`,
    `qa-local-app up --worktree ${mainCheckout} --no-start (slot main, ${slotPaths("main").dataDir}, --profile empty)`,
    "verify: old id gone, new row tagged and pinned as its receipt says, Dev-host invariant",
  ];
  if (flags.has("plan")) {
    return {
      ok: true,
      action: "plan",
      devDb: dbPath,
      row: { id: legacy.id, displayName: legacy.display_name, dbStatus: legacy.status, runtimeStatus },
      rowSha256: backup.sha256,
      storageLink,
      mainCheckout,
      steps,
      blockers,
      restore,
      next: blockers.length
        ? `Other rows break the Dev-host invariant; clear them first: ${pruneFirst}`
        : `node ${join(SCRIPT_DIR, "migrate-dev-signals-row.mjs")} --cli <wrapper> --expect-row-sha256 ${backup.sha256}`,
    };
  }
  if (blockers.length) {
    fail("DEV_HOST_UNSAFE", `Other Dev host rows break the invariant: ${blockers.join("; ")}.`, `Nothing was changed. Clear them first (${pruneFirst}), then rerun.`, { blockers });
  }

  if (!cliPath) fail("USAGE", "--cli is required to apply the migration.", "Rerun with --cli <wrapper for the owner's scoped key>.");
  const expected = flags.get("expect-row-sha256");
  if (!expected) fail("USAGE", "--expect-row-sha256 is required to apply the migration.", "Run --plan and pass its rowSha256.");
  if (expected !== backup.sha256) {
    fail("ROW_CHANGED", `The row's sha256 is ${backup.sha256}, not the approved ${expected}.`, "The row changed since approval; run --plan and request a fresh judgment.");
  }

  // 1-2. Backups, before any write.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = backupsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rowBackup = join(dir, `${stamp}-dev-signals-row.json`);
  const dbBackup = join(dir, `${stamp}-realtimex-dev.db`);
  writeFileSync(rowBackup, backup.text, { encoding: "utf8", mode: 0o600, flag: "wx" });
  if (/['"\n]/.test(dbBackup)) fail("BACKUP_FAILED", `Unsafe backup path ${dbBackup}.`, "Use a Dev root without quotes.");
  const dbCopy = spawnSync("sqlite3", ["-readonly", "-cmd", ".timeout 10000", dbPath, `.backup '${dbBackup}'`], { encoding: "utf8" });
  const check = dbCopy.status === 0 ? spawnSync("sqlite3", ["-readonly", dbBackup, "pragma quick_check;"], { encoding: "utf8" }) : null;
  if (dbCopy.status !== 0 || check?.stdout.trim() !== "ok") {
    fail("BACKUP_FAILED", dbCopy.stderr?.trim() || check?.stdout.trim() || "Backup B failed its quick_check.", "Nothing was changed; fix the cause and rerun.", { rowBackup });
  }

  // 3. Delete through the Dev host's CLI.
  cli(["delete-local-app", CANONICAL_SIGNALS_APP_ID, "--confirm-destructive", "true"], cliPath);
  const listed = appsFromCliPayload(cli(["list-local-apps", "--data-source", "live", "--no-cache"], cliPath));
  if (listed.some((app) => app.id === CANONICAL_SIGNALS_APP_ID)) {
    fail("DELETE_FAILED", "The legacy row is still listed after delete.", "Stop and tell the owner; restore is not needed yet.", { backups: { rowBackup, dbBackup } });
  }

  // 4. The storage entry is a symlink to the main checkout: unlink it, never recurse.
  let symlink = { path: storageLink, action: "absent" };
  let linkStat = null;
  try {
    linkStat = lstatSync(storageLink);
  } catch {
    linkStat = null;
  }
  if (linkStat) {
    const target = linkStat.isSymbolicLink() ? resolve(dirname(storageLink), readlinkSync(storageLink)) : null;
    if (target && target === mainCheckout) {
      unlinkSync(storageLink);
      symlink = { path: storageLink, action: "unlinked", target };
    } else {
      symlink = {
        path: storageLink,
        action: "left in place",
        reason: target ? `it points at ${target}, not ${mainCheckout}` : "it is not a symlink",
      };
    }
  }

  // 5. Provision the replacement through the ordinary launcher, without starting it.
  const launcherArgs = [LAUNCHER, "up", "--worktree", mainCheckout, "--no-start", "--cli", cliPath, "--db", dbPath];
  if (flags.get("packaged-db")) launcherArgs.push("--packaged-db", flags.get("packaged-db"));
  const provision = spawnSync(process.execPath, launcherArgs, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  let created = null;
  try {
    created = JSON.parse(provision.stdout);
  } catch {
    created = null;
  }
  if (provision.status !== 0 || !created?.ok) {
    fail(
      "PROVISION_FAILED",
      `The legacy row is deleted but ${devAppDisplayName("main")} was not created: ${created?.errorCode ?? ""} ${created?.error ?? provision.stderr.trim()}`.trim(),
      `Follow the launcher's next (${created?.next ?? "rerun qa-local-app up --worktree <main> --no-start"}); to undo instead, use restore.rowOnly.`,
      { backups: { rowBackup, dbBackup }, symlink, launcher: created, restore },
    );
  }

  // 6. Verify against the host and the database.
  const after = readRows(dbPath);
  const now = appsFromCliPayload(cli(["list-local-apps", "--data-source", "live", "--no-cache"], cliPath));
  const newRow = after.find((row) => row.id === created.appId);
  const newConfig = rowConfig(newRow);
  const verifyProblems = [];
  if (after.some((row) => row.id === CANONICAL_SIGNALS_APP_ID) || now.some((app) => app.id === CANONICAL_SIGNALS_APP_ID)) {
    verifyProblems.push("the legacy id is still present");
  }
  if (!newRow || !now.some((app) => app.id === created.appId)) verifyProblems.push("the new app is missing");
  if (newRow) {
    for (const tag of ["signals", "dev", "slot-main"]) {
      if (!rowTags(newRow).includes(tag)) verifyProblems.push(`the new app lacks tag ${tag}`);
    }
    if (newConfig.env?.SIGNALS_INSTANCE !== "dev") verifyProblems.push("the new app is not SIGNALS_INSTANCE=dev");
    if (resolve(String(newConfig.env?.SIGNALS_DATA_DIR || "")) !== slotPaths("main").dataDir) {
      verifyProblems.push(`the new app's SIGNALS_DATA_DIR is ${newConfig.env?.SIGNALS_DATA_DIR}`);
    }
    if (String(newConfig.env?.PORT) !== String(created.port)) verifyProblems.push("the new app's PORT differs from its receipt");
  }
  const isLegacyQa = (row) => Boolean(legacyQaIssueId(row));
  const invariant = devHostProblems(after.filter((row) => !isLegacyQa(row)));
  const legacyQa = devHostProblems(after.filter(isLegacyQa));
  verifyProblems.push(...invariant);
  const result = {
    ok: verifyProblems.length === 0,
    action: "migrate",
    devDb: dbPath,
    removedAppId: CANONICAL_SIGNALS_APP_ID,
    backups: { row: rowBackup, rowSha256: backup.sha256, database: dbBackup },
    symlink,
    created: {
      appId: created.appId,
      displayName: created.displayName,
      port: created.port,
      dataDir: created.dataDir,
      receiptPath: created.receiptPath,
    },
    devHostProblems: invariant,
    legacyQaProblems: legacyQa,
    restore,
    next: legacyQa.length
      ? `Old per-issue QA apps still break the Dev-host invariant: node ${LAUNCHER} prune --legacy-qa --apply --cli <wrapper> --db ${dbPath}`
      : `node ${LAUNCHER} up --worktree ${mainCheckout}`,
  };
  if (!result.ok) {
    return { ...result, errorCode: "VERIFY_FAILED", error: verifyProblems.join("; "), next: "Stop and tell the owner; the backups and restore commands are above." };
  }
  return result;
}

try {
  const result = await main();
  if (result) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  }
} catch (error) {
  const coded =
    error instanceof SlotError
      ? error
      : new SlotError("UNEXPECTED", error?.message || String(error), { next: "Report the error; change nothing by hand." });
  process.stdout.write(`${JSON.stringify({ ok: false, action: "migrate", errorCode: coded.errorCode, error: coded.message, ...coded.extra }, null, 2)}\n`);
  process.stderr.write(`migrate-dev-signals-row: ${coded.errorCode}: ${coded.message}\n`);
  process.exit(coded.errorCode === "USAGE" ? 2 : 1);
}
