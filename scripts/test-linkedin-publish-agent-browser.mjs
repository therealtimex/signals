#!/usr/bin/env node
/**
 * Deterministic adapter tests for linkedin-publish.cjs against a fake agent-browser CLI that models
 * LinkedIn's current feed (no profile link in the navigation) and agent-browser 0.34.0 output.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const skillDir = join(root, "..", ".claude", "skills", "signals-publish");
const scriptPath = join(skillDir, "scripts", "linkedin-publish.cjs");
const fakeAb = join(root, "fixtures", "fake-agent-browser-linkedin.cjs");
const fakeSignalsFetch = join(root, "fixtures", "fake-signals-publish-fetch.cjs");
let sequence = 0;

function runLinkedInPublish(payload, extraEnv = {}, extraArgs = []) {
  const workDir = mkdtempSync(join(tmpdir(), "linkedin-publish-adapter-"));
  const payloadPath = join(workDir, "payload.json");
  const stateFile = join(workDir, "fake-ab-state.json");
  const n = ++sequence;
  writeFileSync(payloadPath, JSON.stringify({
    jobId: `pj_test_li_${n}`,
    contentItemId: `item_test_li_${n}`,
    targetId: "tgt_test_linkedin",
    text: "LinkedIn adapter test",
    expectedHandle: "/in/session-owner",
    ...payload,
  }));
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--port", "9222", "--payload", payloadPath, ...extraArgs],
    {
      cwd: skillDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_BIN: process.execPath,
        AGENT_BROWSER_BIN_ARGS: fakeAb,
        SIGNALS_PUBLISH_AB_SESSION: "fake-session",
        FAKE_AB_STATE_FILE: stateFile,
        FAKE_SIGNALS_PUBLISH_PAYLOAD_FILE: payloadPath,
        SIGNALS_BASE_URL: "http://127.0.0.1:3010",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${fakeSignalsFetch}`.trim(),
        ...extraEnv,
      },
    },
  );
  const browserState = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  rmSync(workDir, { recursive: true, force: true });
  const line = result.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  let output = null;
  try {
    output = JSON.parse(line);
  } catch {
    // reported by the assertion below
  }
  return { result, output, browserState };
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`not ok - ${name}\n${detail}`);
  }
}

function describe(run) {
  return `stdout: ${run.result.stdout}\nstderr: ${run.result.stderr.slice(-2000)}\ncommands: ${JSON.stringify(run.browserState?.commands ?? [])}`;
}

{
  // The first `/in/` link in the feed is someone else's; only `/in/me/` names the session owner.
  const run = runLinkedInPublish({}, {}, ["--dry-run"]);
  check(
    "dry run verifies the signed-in profile through /in/me/ and fills the composer",
    run.output?.success === true &&
      run.output?.dryRun === true &&
      run.output?.handle === "/in/session-owner" &&
      run.browserState?.text === "LinkedIn adapter test" &&
      run.browserState?.posted === false,
    describe(run),
  );
}

{
  const run = runLinkedInPublish({ expectedHandle: "/in/Session-Owner/" });
  check(
    "publishes and reads the permalink from agent-browser's JSON-encoded eval result",
    run.output?.success === true &&
      run.output?.platformUrl ===
        "https://www.linkedin.com/feed/update/urn:li:activity:7123456789/" &&
      run.output?.platformPostId === "7123456789" &&
      run.browserState?.posted === true,
    describe(run),
  );
}

{
  const run = runLinkedInPublish({}, {
    FAKE_LI_SELF: "other-account",
    FAKE_LI_FIRST_PROFILE_LINK: "session-owner",
  });
  check(
    "refuses a different signed-in account even when the feed links to the expected profile",
    run.output?.success === false &&
      run.output?.errorCode === "wrong_account" &&
      run.output?.detectedHandle === "other-account" &&
      run.browserState?.composerOpen === false &&
      run.browserState?.posted === false,
    describe(run),
  );
}

{
  const run = runLinkedInPublish({}, { FAKE_LI_SELF: "" });
  check(
    "reports a signed-out session before opening the composer",
    run.output?.success === false &&
      run.output?.errorCode === "session_expired" &&
      run.browserState?.composerOpen === false,
    describe(run),
  );
}

if (failures > 0) {
  console.error(`${failures} linkedin-publish adapter test(s) failed`);
  process.exit(1);
}
console.log("linkedin-publish adapter tests passed");
