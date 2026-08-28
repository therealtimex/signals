#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  DEFAULT_DEV_CLI_BASE_URL,
  appsFromCliPayload,
  assertSafeQaApp,
  assertSafeQaDataDir,
  defaultQaDataDir,
  findIssueQaApps,
  normalizeIssueId,
  parseFlagArgs,
  qaReceiptPath,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";

function usage() {
  console.log(`Usage:
  node scripts/qa/cleanup-signals-qa-local-app.mjs --issue <number> \\
    [--app-id <uuid>] [--data-dir /private/tmp/signals-qa-...] \\
    [--base-url http://127.0.0.1:3101/cli] [--keep-data]

Stops and deletes only a safety-tagged issue QA app. The canonical Signals app is rejected.`);
}

try {
  const flags = parseFlagArgs(process.argv.slice(2));
  if (flags.has("help")) {
    usage();
    process.exit(0);
  }

  const issueId = normalizeIssueId(flags.get("issue"));
  const receiptPath = qaReceiptPath(issueId);
  const receipt = existsSync(receiptPath)
    ? JSON.parse(readFileSync(receiptPath, "utf8"))
    : null;
  if (receipt && (receipt.kind !== "signals-qa-local-app" || receipt.issueId !== issueId)) {
    throw new Error(`Invalid QA receipt at ${receiptPath}.`);
  }

  const requestedAppId = flags.get("app-id") || receipt?.appId || "";
  const dataDir = assertSafeQaDataDir(
    flags.get("data-dir") || receipt?.dataDir || defaultQaDataDir(issueId),
  );
  const baseUrl = flags.get("base-url") || receipt?.baseUrl || DEFAULT_DEV_CLI_BASE_URL;
  const cliOptions = { baseUrl, cli: flags.get("cli") };

  const before = appsFromCliPayload(
    runRealtimeXCli(["list-local-apps", "--data-source", "live", "--no-cache"], cliOptions),
  );
  const candidates = requestedAppId
    ? before.filter((app) => app.id === requestedAppId)
    : findIssueQaApps(before, issueId);
  if (candidates.length > 1) {
    throw new Error(`Multiple issue-${issueId} QA apps exist; pass --app-id explicitly.`);
  }

  const app = candidates[0] || null;
  if (app) {
    assertSafeQaApp(app, issueId);
    const runtimeStatus = app.runtime?.status || app.persistedStatus || app.status;
    if (!["stopped", "disabled", null, undefined].includes(runtimeStatus)) {
      runRealtimeXCli(["stop-local-app", app.id], cliOptions);
    }
    runRealtimeXCli(
      ["delete-local-app", app.id, "--confirm-destructive", "true", "--ignore-missing"],
      cliOptions,
    );

    const after = appsFromCliPayload(
      runRealtimeXCli(["list-local-apps", "--data-source", "live", "--no-cache"], cliOptions),
    );
    if (after.some((candidate) => candidate.id === app.id)) {
      throw new Error(`QA Local App ${app.id} still exists after deletion.`);
    }
  }

  let dataRemoved = false;
  if (!flags.has("keep-data") && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    dataRemoved = true;
  }
  if (existsSync(receiptPath)) rmSync(receiptPath, { force: true });

  console.log(
    JSON.stringify(
      {
        ok: true,
        issueId,
        appId: app?.id || requestedAppId || null,
        appDeleted: Boolean(app),
        dataDir,
        dataRemoved,
        receiptRemoved: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`QA Local App cleanup failed: ${error.message}`);
  process.exit(1);
}
