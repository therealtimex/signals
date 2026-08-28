#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  DEFAULT_DEV_CLI_BASE_URL,
  appsFromCliPayload,
  assertIssueBoundQaDataDir,
  assertSafeQaApp,
  assertSafeQaDataDir,
  defaultQaDataDir,
  findIssueQaApps,
  normalizeIssueId,
  parseFlagArgs,
  qaReceiptPath,
  qaTemporaryRoot,
  runRealtimeXCli,
} from "./signals-qa-local-app.mjs";

function usage() {
  console.log(`Usage:
  node scripts/qa/cleanup-signals-qa-local-app.mjs --issue <number> \\
    [--app-id <uuid>] [--data-dir <platform-temp>/signals-qa-...] \\
    [--base-url http://127.0.0.1:3101/cli] [--keep-data]

Stops and deletes only a safety-tagged issue QA app. The canonical Signals app is rejected.
The platform temp directory on this host is ${qaTemporaryRoot()}.
When a receipt exists, app, data, and base URL overrides must match it.`);
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
  if (
    receipt &&
    (receipt.kind !== "signals-qa-local-app" ||
      receipt.issueId !== issueId ||
      !receipt.appId ||
      !receipt.dataDir ||
      !receipt.baseUrl)
  ) {
    throw new Error(`Invalid QA receipt at ${receiptPath}.`);
  }

  const appIdOverride = flags.get("app-id");
  const dataDirOverride = flags.get("data-dir");
  const baseUrlOverride = flags.get("base-url");
  const receiptDataDir = receipt ? assertSafeQaDataDir(receipt.dataDir) : "";
  if (receipt && appIdOverride && appIdOverride !== receipt.appId) {
    throw new Error(`--app-id conflicts with the receipt at ${receiptPath}.`);
  }
  if (
    receipt &&
    dataDirOverride &&
    assertSafeQaDataDir(dataDirOverride) !== receiptDataDir
  ) {
    throw new Error(`--data-dir conflicts with the receipt at ${receiptPath}.`);
  }
  if (receipt && baseUrlOverride && baseUrlOverride !== receipt.baseUrl) {
    throw new Error(`--base-url conflicts with the receipt at ${receiptPath}.`);
  }

  const requestedAppId = receipt?.appId || appIdOverride;
  const dataDir = receipt
    ? receiptDataDir
    : assertIssueBoundQaDataDir(dataDirOverride || defaultQaDataDir(issueId), issueId);
  const baseUrl = receipt?.baseUrl || baseUrlOverride || DEFAULT_DEV_CLI_BASE_URL;
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
  if (!app && receipt) {
    throw new Error(
      `Receipt-backed QA Local App ${receipt.appId} was not found; retaining its data and receipt.`,
    );
  }
  if (!app && appIdOverride) {
    throw new Error(`Requested QA Local App ${appIdOverride} was not found.`);
  }
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
  let receiptRemoved = false;
  if (existsSync(receiptPath)) {
    rmSync(receiptPath, { force: true });
    receiptRemoved = true;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        issueId,
        appId: app?.id || requestedAppId || null,
        appDeleted: Boolean(app),
        dataDir,
        dataRemoved,
        receiptRemoved,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`QA Local App cleanup failed: ${error.message}`);
  process.exit(1);
}
