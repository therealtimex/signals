#!/usr/bin/env node
/**
 * Deterministic adapter tests for x-publish.cjs against a fake agent-browser CLI.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseEvalJsonArray, parseEvalJsonValue } = require(
  "../.claude/skills/signals-publish/scripts/parse-eval-json-array.cjs"
);

const root = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(
  root,
  "..",
  ".claude",
  "skills",
  "signals-publish",
  "scripts",
  "x-publish.cjs"
);
const fakeAb = join(root, "fixtures", "fake-agent-browser.cjs");

function runXPublish(payload, extraEnv = {}, extraArgs = []) {
  const workDir = mkdtempSync(join(tmpdir(), "x-publish-adapter-"));
  const payloadPath = join(workDir, "payload.json");
  const stateFile = join(workDir, "fake-ab-state.json");
  writeFileSync(payloadPath, JSON.stringify(payload));
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--port", "9222", "--payload", payloadPath, ...extraArgs], {
    cwd: join(root, "..", ".claude", "skills", "signals-publish"),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BROWSER_BIN: process.execPath,
      AGENT_BROWSER_BIN_ARGS: fakeAb,
      SIGNALS_PUBLISH_AB_SESSION: "fake-session",
      FAKE_AB_STATE_FILE: stateFile,
      FAKE_AB_FAIL_ADD: "",
      FAKE_AB_FAIL_THREAD_FILL: "",
      ...extraEnv,
    },
  });
  rmSync(workDir, { recursive: true, force: true });
  return result;
}

function lastJson(stdout) {
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  return JSON.parse(line);
}

// Happy path: handle detection, thread compose, verified post
const happy = runXPublish({
  text: "thread tweet one",
  threadTexts: ["thread tweet two"],
});
if (happy.status !== 0) {
  console.error("happy path failed:", happy.stdout, happy.stderr);
  process.exit(1);
}
const happyJson = lastJson(happy.stdout);
if (!happyJson.success || happyJson.handle !== "@smokeuser") {
  console.error("unexpected happy result:", happyJson);
  process.exit(1);
}

// Thread fill failure must abort before success
const threadFail = runXPublish(
  { text: "only", threadTexts: ["second"] },
  { FAKE_AB_FAIL_THREAD_FILL: "1" }
);
if (threadFail.status === 0) {
  console.error("thread fill failure should not succeed");
  process.exit(1);
}

const dryRun = runXPublish({ text: "dry only", threadTexts: ["dry two"] }, {}, [
  "--dry-run",
]);
if (dryRun.status !== 0) {
  console.error("dry-run failed:", dryRun.stdout, dryRun.stderr);
  process.exit(1);
}
const dryJson = lastJson(dryRun.stdout);
if (!dryJson.success || !dryJson.dryRun) {
  console.error("unexpected dry-run result:", dryJson);
  process.exit(1);
}

// Regression: real agent-browser JSON-encodes string eval results.
if (parseEvalJsonArray('"[]"').length !== 0) {
  console.error("parseEvalJsonArray failed on quoted empty array");
  process.exit(1);
}
if (parseEvalJsonArray("[]").length !== 0) {
  console.error("parseEvalJsonArray failed on raw empty array");
  process.exit(1);
}
const focusPayload = parseEvalJsonValue(JSON.stringify(JSON.stringify({ ok: true })));
if (!focusPayload?.ok) {
  console.error("parseEvalJsonValue failed on nested object eval");
  process.exit(1);
}

// Eval insert path when keyboard type does not commit (fake simulates live Draft.js)
const evalInsert = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_SKIP_KEYBOARD: "1" },
  ["--dry-run"]
);
if (evalInsert.status !== 0) {
  console.error("eval insert path failed:", evalInsert.stdout, evalInsert.stderr);
  process.exit(1);
}
const evalInsertJson = lastJson(evalInsert.stdout);
if (!evalInsertJson.success || !evalInsertJson.dryRun) {
  console.error("unexpected eval insert dry-run result:", evalInsertJson);
  process.exit(1);
}

const scopedAdd = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_HIDE_GLOBAL_ADD: "1" },
  ["--dry-run"]
);
if (scopedAdd.status !== 0) {
  console.error("scoped add path failed:", scopedAdd.stdout, scopedAdd.stderr);
  process.exit(1);
}
const scopedAddJson = lastJson(scopedAdd.stdout);
if (!scopedAddJson.success || !scopedAddJson.dryRun) {
  console.error("unexpected scoped add dry-run result:", scopedAddJson);
  process.exit(1);
}

const resetOnClick = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_RESET_ON_ADD_CLICK: "1" },
  ["--dry-run"]
);
if (resetOnClick.status !== 0) {
  console.error("reset-on-click recovery failed:", resetOnClick.stdout, resetOnClick.stderr);
  process.exit(1);
}
const resetOnClickJson = lastJson(resetOnClick.stdout);
if (!resetOnClickJson.success || !resetOnClickJson.dryRun) {
  console.error("unexpected reset-on-click dry-run result:", resetOnClickJson);
  process.exit(1);
}

console.log("x-publish agent-browser adapter: OK");
