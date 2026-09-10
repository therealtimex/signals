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

const replyScriptPath = join(
  root,
  "..",
  ".claude",
  "skills",
  "signals-publish",
  "scripts",
  "x-reply.cjs"
);

function runXReply(payload, extraEnv = {}, extraArgs = []) {
  const workDir = mkdtempSync(join(tmpdir(), "x-reply-adapter-"));
  const payloadPath = join(workDir, "payload.json");
  const stateFile = join(workDir, "fake-ab-state.json");
  writeFileSync(payloadPath, JSON.stringify(payload));
  const result = spawnSync(
    process.execPath,
    [replyScriptPath, "--port", "9222", "--payload", payloadPath, ...extraArgs],
    {
      cwd: join(root, "..", ".claude", "skills", "signals-publish"),
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BROWSER_BIN: process.execPath,
        AGENT_BROWSER_BIN_ARGS: fakeAb,
        SIGNALS_PUBLISH_AB_SESSION: "fake-session",
        FAKE_AB_STATE_FILE: stateFile,
        ...extraEnv,
      },
    }
  );
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

// Target-aware jobs must fail closed before compose when the live account differs.
const wrongAccount = runXPublish(
  { text: "must not publish", expectedHandle: "@someoneelse" },
  {},
  ["--dry-run"]
);
if (wrongAccount.status === 0) {
  console.error("wrong account should not succeed");
  process.exit(1);
}
const wrongAccountJson = lastJson(wrongAccount.stdout);
if (wrongAccountJson.success || wrongAccountJson.errorCode !== "wrong_account") {
  console.error("unexpected wrong-account result:", wrongAccountJson);
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

// Clipboard fallback when keyboard inserttext does not commit
const clipboardInsert = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_SKIP_KEYBOARD: "1" },
  ["--dry-run"]
);
if (clipboardInsert.status !== 0) {
  console.error("clipboard insert path failed:", clipboardInsert.stdout, clipboardInsert.stderr);
  process.exit(1);
}
const clipboardInsertJson = lastJson(clipboardInsert.stdout);
if (!clipboardInsertJson.success || !clipboardInsertJson.dryRun) {
  console.error("unexpected clipboard insert dry-run result:", clipboardInsertJson);
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

const globalAddOnly = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_GLOBAL_ADD_ONLY: "1" },
  ["--dry-run"]
);
if (globalAddOnly.status !== 0) {
  console.error("global-add-only path failed:", globalAddOnly.stdout, globalAddOnly.stderr);
  process.exit(1);
}
const globalAddOnlyJson = lastJson(globalAddOnly.stdout);
if (!globalAddOnlyJson.success || !globalAddOnlyJson.dryRun) {
  console.error("unexpected global-add-only dry-run result:", globalAddOnlyJson);
  process.exit(1);
}

const dialogAddOnly = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_DIALOG_ADD_ONLY: "1" },
  ["--dry-run"]
);
if (dialogAddOnly.status !== 0) {
  console.error("dialog-add-only path failed:", dialogAddOnly.stdout, dialogAddOnly.stderr);
  process.exit(1);
}
const dialogAddOnlyJson = lastJson(dialogAddOnly.stdout);
if (!dialogAddOnlyJson.success || !dialogAddOnlyJson.dryRun) {
  console.error("unexpected dialog-add-only dry-run result:", dialogAddOnlyJson);
  process.exit(1);
}

// Live QA regression: duplicate tweetTextarea_0 without tweetTextarea_1 must fail validation.
const duplicateZero = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_DUPLICATE_TEXTAREA_0: "1" },
  ["--dry-run"]
);
if (duplicateZero.status === 0) {
  console.error("duplicate tweetTextarea_0 should fail compose validation");
  process.exit(1);
}
const duplicateZeroJson = lastJson(duplicateZero.stdout);
if (duplicateZeroJson.success) {
  console.error("duplicate tweetTextarea_0 should not return success");
  process.exit(1);
}

const noThreadAdd = runXPublish(
  { text: "thread tweet one", threadTexts: ["thread tweet two"] },
  { FAKE_AB_NO_THREAD_ADD: "1" },
  ["--dry-run"]
);
if (noThreadAdd.status === 0) {
  console.error("no thread add should fail dry-run");
  process.exit(1);
}
const noThreadAddJson = lastJson(noThreadAdd.stdout);
if (
  noThreadAddJson.success ||
  !String(noThreadAddJson.error || "").includes("thread compose slot")
) {
  console.error("unexpected no-thread-add result:", noThreadAddJson);
  process.exit(1);
}

const legacyThreadField = runXPublish(
  { text: "main only", threadText: "should fail" },
  {},
  ["--dry-run"]
);
if (legacyThreadField.status === 0) {
  console.error("legacy threadText field should fail");
  process.exit(1);
}

const multiParagraph = `Intro paragraph stays in the draft.

1. First item must survive submit.
2. Second item must survive submit.
3. Test Codex in a separate git worktree first.`;

const multiPublish = runXPublish({ text: multiParagraph }, {}, ["--dry-run"]);
if (multiPublish.status !== 0) {
  console.error("multi-paragraph dry-run failed:", multiPublish.stdout, multiPublish.stderr);
  process.exit(1);
}

const truncatedPublish = runXPublish(
  { text: multiParagraph },
  { FAKE_AB_TRUNCATE_ACTIVE_BLOCK: "1" },
  ["--dry-run"]
);
if (truncatedPublish.status === 0) {
  console.error("truncated active-block compose should fail pre-submit");
  process.exit(1);
}
const truncatedPublishJson = lastJson(truncatedPublish.stdout);
if (
  truncatedPublishJson.success ||
  !String(truncatedPublishJson.error || "").includes("full drafted text")
) {
  console.error("unexpected truncated compose result:", truncatedPublishJson);
  process.exit(1);
}

const leafDesyncPublish = runXPublish(
  { text: multiParagraph },
  { FAKE_AB_DOM_LEAF_DESYNC: "1" },
  ["--dry-run"]
);
if (leafDesyncPublish.status === 0) {
  console.error("DOM/EditorState leaf desync should fail pre-submit");
  process.exit(1);
}
const leafDesyncJson = lastJson(leafDesyncPublish.stdout);
if (
  leafDesyncJson.success ||
  !String(leafDesyncJson.error || "").includes("full drafted text") ||
  !String(leafDesyncJson.error || "").includes("draft_leaf_mismatch")
) {
  console.error("unexpected leaf-desync compose result:", leafDesyncJson);
  process.exit(1);
}

const staleEarlierSlot = runXPublish(
  {
    text: "thread tweet one",
    threadTexts: [
      "Continuation paragraph one.\n\nContinuation paragraph two.",
      "Third slot stays intact.",
    ],
  },
  { FAKE_AB_STALE_EARLIER_SLOT: "1" },
  ["--dry-run"]
);
if (staleEarlierSlot.status === 0) {
  console.error("stale earlier thread slot should fail final pre-submit");
  process.exit(1);
}
const staleEarlierJson = lastJson(staleEarlierSlot.stdout);
if (
  staleEarlierJson.success ||
  !String(staleEarlierJson.error || "").includes("pre-submit thread slot 1")
) {
  console.error("unexpected stale earlier-slot result:", staleEarlierJson);
  process.exit(1);
}

const replyPayload = {
  text: multiParagraph,
  sourcePostUrl: "https://x.com/JaeHokes/status/2097877302017130541",
};
const replyOk = runXReply(replyPayload, {}, ["--dry-run"]);
if (replyOk.status !== 0) {
  console.error("x-reply dry-run failed:", replyOk.stdout, replyOk.stderr);
  process.exit(1);
}
const replyOkJson = lastJson(replyOk.stdout);
if (!replyOkJson.success || !replyOkJson.dryRun || replyOkJson.kind !== "reply") {
  console.error("unexpected x-reply result:", replyOkJson);
  process.exit(1);
}

const replyTruncated = runXReply(
  replyPayload,
  { FAKE_AB_TRUNCATE_ACTIVE_BLOCK: "1" },
  ["--dry-run"]
);
if (replyTruncated.status === 0) {
  console.error("truncated inline reply should fail pre-submit");
  process.exit(1);
}
const replyTruncatedJson = lastJson(replyTruncated.stdout);
if (
  replyTruncatedJson.success ||
  !String(replyTruncatedJson.error || "").includes("full drafted reply")
) {
  console.error("unexpected truncated reply result:", replyTruncatedJson);
  process.exit(1);
}

const replyPublished = runXReply(replyPayload);
if (replyPublished.status !== 0) {
  console.error("x-reply publish failed:", replyPublished.stdout, replyPublished.stderr);
  process.exit(1);
}
const replyPublishedJson = lastJson(replyPublished.stdout);
if (
  !replyPublishedJson.success ||
  replyPublishedJson.kind !== "reply" ||
  !replyPublishedJson.platformPostId ||
  !String(replyPublishedJson.platformUrl || "").includes(`/status/${replyPublishedJson.platformPostId}`) ||
  replyPublishedJson.platformUrl === replyPayload.sourcePostUrl
) {
  console.error("x-reply must return the new reply URL, not the source post:", replyPublishedJson);
  process.exit(1);
}

const replyRejectedClick = runXReply(replyPayload, { FAKE_AB_REJECT_REPLY_CLICK: "1" });
if (replyRejectedClick.status === 0) {
  console.error("rejected reply click should not succeed");
  process.exit(1);
}
const replyRejectedClickJson = lastJson(replyRejectedClick.stdout);
if (
  replyRejectedClickJson.success ||
  !String(replyRejectedClickJson.error || "").includes("simulated reply submit rejection")
) {
  console.error("unexpected rejected-click reply result:", replyRejectedClickJson);
  process.exit(1);
}

const replyNotAccepted = runXReply(replyPayload, {
  FAKE_AB_REPLY_NOT_ACCEPTED: "1",
  SIGNALS_PUBLISH_VERIFY_TIMEOUT_MS: "250",
});
if (replyNotAccepted.status === 0) {
  console.error("unverified reply click should not succeed");
  process.exit(1);
}
const replyNotAcceptedJson = lastJson(replyNotAccepted.stdout);
if (
  replyNotAcceptedJson.success ||
  replyNotAcceptedJson.errorCode !== "verify_uncertain" ||
  replyNotAcceptedJson.submitted !== true ||
  !String(replyNotAcceptedJson.error || "").includes("Do not click Reply again") ||
  replyNotAcceptedJson.platformUrl === replyPayload.sourcePostUrl
) {
  console.error("unexpected unverified reply result:", replyNotAcceptedJson);
  process.exit(1);
}

const replyPrefixOnly = runXReply(replyPayload, {
  FAKE_AB_REPLY_PREFIX_ONLY: "1",
  SIGNALS_PUBLISH_VERIFY_TIMEOUT_MS: "250",
});
if (replyPrefixOnly.status === 0) {
  console.error("prefix-only published reply should fail full-text verification");
  process.exit(1);
}
const replyPrefixOnlyJson = lastJson(replyPrefixOnly.stdout);
if (
  replyPrefixOnlyJson.success ||
  replyPrefixOnlyJson.errorCode !== "verify_uncertain" ||
  replyPrefixOnlyJson.submitted !== true
) {
  console.error("unexpected prefix-only reply result:", replyPrefixOnlyJson);
  process.exit(1);
}

const replyHiddenFromThread = runXReply(replyPayload, {
  FAKE_AB_REPLY_HIDDEN_FROM_THREAD: "1",
});
if (replyHiddenFromThread.status !== 0) {
  console.error(
    "owned replies timeline should confirm a reply missing from the thread DOM:",
    replyHiddenFromThread.stdout,
    replyHiddenFromThread.stderr
  );
  process.exit(1);
}
const replyHiddenJson = lastJson(replyHiddenFromThread.stdout);
if (
  !replyHiddenJson.success ||
  !replyHiddenJson.platformPostId ||
  replyHiddenJson.platformUrl === replyPayload.sourcePostUrl
) {
  console.error("unexpected hidden-from-thread reply result:", replyHiddenJson);
  process.exit(1);
}

console.log("x-publish agent-browser adapter: OK");
