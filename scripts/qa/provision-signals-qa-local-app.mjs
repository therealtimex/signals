#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import {
  CANONICAL_SIGNALS_APP_ID,
  DEFAULT_DEV_CLI_BASE_URL,
  appFromCliPayload,
  appsFromCliPayload,
  assertSafeQaApp,
  assertSafeQaDataDir,
  assertSignalsIssueWorktree,
  buildQaCreateCliArgs,
  defaultQaDataDir,
  findIssueQaApps,
  normalizeIssueId,
  parseFlagArgs,
  qaAppDisplayName,
  qaAppTags,
  qaReceiptPath,
  qaTemporaryRoot,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";

function usage() {
  console.log(`Usage:
  node scripts/qa/provision-signals-qa-local-app.mjs \\
    --issue <number> --worktree <absolute-path> [--loop-id <id>] \\
    [--data-dir <platform-temp>/signals-qa-...] [--base-url http://127.0.0.1:3101/cli] \\
    [--no-start]

Creates a new issue-scoped QA Local App. It never updates the canonical Signals app.
The platform temp directory on this host is ${qaTemporaryRoot()}.`);
}

try {
  const flags = parseFlagArgs(process.argv.slice(2));
  if (flags.has("help")) {
    usage();
    process.exit(0);
  }

  const issueId = normalizeIssueId(flags.get("issue"));
  const worktree = assertSignalsIssueWorktree(flags.get("worktree"));
  const dataDir = defaultQaDataDir(issueId);
  const requestedDataDir = assertSafeQaDataDir(flags.get("data-dir", dataDir));
  const loopId = flags.get("loop-id");
  const baseUrl = flags.get("base-url") || DEFAULT_DEV_CLI_BASE_URL;
  const cliOptions = { baseUrl, cli: flags.get("cli") };
  const receiptPath = qaReceiptPath(issueId);

  if (existsSync(receiptPath)) {
    throw new Error(
      `QA receipt already exists at ${receiptPath}. Run cleanup-signals-qa-local-app.mjs first.`,
    );
  }
  if (existsSync(requestedDataDir)) {
    throw new Error(
      `QA data directory already exists at ${requestedDataDir}. Run cleanup-signals-qa-local-app.mjs first.`,
    );
  }

  const before = appsFromCliPayload(
    runRealtimeXCli(["list-local-apps", "--data-source", "live", "--no-cache"], cliOptions),
  );
  const existing = findIssueQaApps(before, issueId);
  if (existing.length) {
    throw new Error(
      `${qaAppDisplayName(issueId)} already exists (${existing.map((app) => app.id).join(", ")}). ` +
        "Clean it up before provisioning a new QA app.",
    );
  }

  const createArgs = buildQaCreateCliArgs({
    issueId,
    worktree: worktree.path,
    dataDir: requestedDataDir,
    loopId,
    baseUrl,
  });
  const createdPayload = runRealtimeXCli(createArgs, cliOptions);
  const created = appFromCliPayload(createdPayload);
  if (!created?.id) throw new Error("Local App creation succeeded without returning an app id.");
  if (created.id === CANONICAL_SIGNALS_APP_ID) {
    throw new Error("Local App creation returned the canonical Signals id; refusing to continue.");
  }

  const receipt = {
    schemaVersion: 1,
    kind: "signals-qa-local-app",
    issueId,
    loopId: loopId || null,
    appId: created.id,
    displayName: qaAppDisplayName(issueId),
    tags: qaAppTags(issueId, loopId),
    branch: worktree.branch,
    worktree: worktree.path,
    dataDir: requestedDataDir,
    baseUrl,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  const after = appsFromCliPayload(
    runRealtimeXCli(["list-local-apps", "--data-source", "live", "--no-cache"], cliOptions),
  );
  const stored = after.find((app) => app.id === created.id);
  assertSafeQaApp(stored, issueId);

  if (!flags.has("no-start")) {
    runRealtimeXCli(["start-local-app", stored.id], cliOptions);
    runRealtimeXCli(["get-local-app-status", stored.id], cliOptions);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        appId: stored.id,
        displayName: receipt.displayName,
        issueId,
        worktree: receipt.worktree,
        dataDir: receipt.dataDir,
        receiptPath,
        started: !flags.has("no-start"),
        cleanupCommand: `node scripts/qa/cleanup-signals-qa-local-app.mjs --issue ${issueId}`,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`QA Local App provision failed: ${error.message}`);
  process.exit(1);
}
