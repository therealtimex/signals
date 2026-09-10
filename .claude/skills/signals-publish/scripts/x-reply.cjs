#!/usr/bin/env node
/**
 * Deterministic X inline reply via host agent-browser CLI.
 *
 * Injects the entire reply as one insertText payload, then refuses to click
 * [data-testid="tweetButtonInline"] unless the Draft.js/Lexical snapshot matches.
 *
 * Usage:
 *   node scripts/x-reply.cjs --port <cdpPort> --payload <reply.json> [--dry-run]
 *
 * Payload: { "text": "...", "sourcePostUrl": "https://x.com/.../status/..." }
 */
"use strict";

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const { parseEvalJsonValue } = require("./parse-eval-json-array.cjs");
const {
  insertComposeTextEvalJs,
  matchComposeSnapshot,
  readComposeSnapshotEvalJs,
} = require("./x-compose-text.cjs");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const AB_PREFIX = process.env.AGENT_BROWSER_BIN_ARGS
  ? process.env.AGENT_BROWSER_BIN_ARGS.split(" ").filter(Boolean)
  : [];
const COMPOSE_WAIT_TIMEOUT_MS = 15_000;
const TYPE_SETTLE_MS = 800;

const REPLY_TEXTAREA = '[data-testid="tweetTextarea_0"]';
const REPLY_BUTTON = '[data-testid="reply"]';
const REPLY_SUBMIT = '[data-testid="tweetButtonInline"]';

let resultEmitted = false;

function emit(result) {
  resultEmitted = true;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.success ? 0 : 1);
}

function parseArgs(argv) {
  let port = null;
  let payloadPath = null;
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--payload") payloadPath = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  if (!port || !payloadPath) {
    emit({
      success: false,
      error: "Usage: node x-reply.cjs --port <cdpPort> --payload <reply.json> [--dry-run]",
      errorCode: "unknown",
    });
  }
  return {
    port,
    payload: JSON.parse(readFileSync(payloadPath, "utf8")),
    dryRun,
  };
}

function validatePayload(payload) {
  const text = String(payload?.text ?? "").trim();
  const sourcePostUrl = String(payload?.sourcePostUrl ?? "").trim();
  if (!text) {
    throw { message: "payload.text is required and must be non-empty", errorCode: "unknown" };
  }
  if (!sourcePostUrl) {
    throw {
      message: "payload.sourcePostUrl is required for inline X replies",
      errorCode: "unknown",
    };
  }
  return { text: payload.text, sourcePostUrl };
}

function runAb(args) {
  const spawnArgs = AB_PREFIX.length
    ? [...AB_PREFIX, "--session", SESSION, ...args]
    : ["--session", SESSION, ...args];
  const result = spawnSync(AB_BIN, spawnArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    combined: [stdout, stderr].filter(Boolean).join("\n"),
    status: result.status ?? 1,
  };
}

function requireAb(args, context, errorCode = "unknown") {
  const result = runAb(args);
  if (!result.ok) {
    throw {
      message: `${context}: ${result.combined || "agent-browser command failed"}`,
      errorCode,
    };
  }
  return result;
}

function abCount(selector) {
  const result = runAb(["get", "count", selector]);
  if (!result.ok) return 0;
  const count = Number(result.stdout);
  return Number.isFinite(count) ? count : 0;
}

function sleep(ms) {
  requireAb(["wait", String(ms)], "wait");
}

function waitForSelector(selector, context, timeoutMs = COMPOSE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (abCount(selector) > 0) return;
    sleep(300);
  }
  throw {
    message: `${context}: timed out waiting for ${selector}`,
    errorCode: "timeout",
  };
}

function isShellTab(tab) {
  const url = String(tab?.url ?? "");
  const title = String(tab?.title ?? "");
  if (/^devtools:/i.test(url)) return true;
  if (/cli-browser\/index\.html/i.test(url)) return true;
  if (/^file:/i.test(url)) return true;
  if (title === "RealTimeX Browser") return true;
  return false;
}

function isContentTab(tab) {
  const url = String(tab?.url ?? "");
  return /^https?:\/\//i.test(url) && !isShellTab(tab);
}

function selectContentTab() {
  const list = requireAb(["tab", "list", "--json"], "list browser tabs");
  let parsed;
  try {
    parsed = JSON.parse(list.stdout);
  } catch {
    throw { message: "Failed to parse agent-browser tab list JSON.", errorCode: "unknown" };
  }
  const tabs = parsed?.data?.tabs ?? [];
  const contentTabs = tabs.filter(isContentTab);
  if (!contentTabs.length) {
    throw {
      message:
        "No HTTP(S) content tab found in RealTimeX Browser. Open the source post in the signals-publish session before replying.",
      errorCode: "unknown",
    };
  }
  const preferred =
    contentTabs.find((tab) => /x\.com|twitter\.com/i.test(String(tab.url))) ?? contentTabs[0];
  requireAb(["tab", preferred.tabId], `switch to content tab ${preferred.tabId}`);
}

function connectSession(port) {
  const connect = runAb(["connect", String(port)]);
  if (!connect.ok && /failed|refused|error/i.test(connect.combined)) {
    throw {
      message: `Failed to connect agent-browser to CDP port ${port}: ${connect.combined}`,
      errorCode: "unknown",
    };
  }
  selectContentTab();
}

function insertReplyText(text) {
  requireAb(["click", REPLY_TEXTAREA], "focus inline reply composer");
  const raw = requireAb(
    ["eval", insertComposeTextEvalJs(REPLY_TEXTAREA, text)],
    "single-pass insertText"
  ).stdout;
  const parsed = parseEvalJsonValue(raw);
  if (!parsed || typeof parsed !== "object") {
    throw {
      message: "single-pass insertText did not return a compose snapshot",
      errorCode: "compose_invalid",
    };
  }
  return parsed;
}

function readReplySnapshot() {
  const raw = requireAb(
    ["eval", readComposeSnapshotEvalJs(REPLY_TEXTAREA)],
    "read compose snapshot"
  ).stdout;
  const parsed = parseEvalJsonValue(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function assertReplyReadyToSubmit(expected) {
  const snapshot = readReplySnapshot() || insertReplyText(expected);
  const match = matchComposeSnapshot(snapshot, expected);
  if (match.ok) return snapshot;
  throw {
    message: `pre-submit compose editor does not contain the full drafted reply (${match.reason}; expected ${JSON.stringify(match.expected)}, actual ${JSON.stringify(match.actual)})`,
    errorCode: "compose_invalid",
  };
}

function main() {
  const { port, payload, dryRun } = parseArgs(process.argv);
  try {
    const { text, sourcePostUrl } = validatePayload(payload);
    connectSession(port);
    requireAb(["open", sourcePostUrl], "open source post");
    sleep(1000);
    waitForSelector(REPLY_BUTTON, "wait for reply button");
    requireAb(["click", REPLY_BUTTON], "open inline reply composer");
    waitForSelector(REPLY_TEXTAREA, "wait for inline reply textarea");
    insertReplyText(text);
    sleep(TYPE_SETTLE_MS);
    assertReplyReadyToSubmit(text);

    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        kind: "reply",
        message:
          "Inline reply filled with a single-pass insertText payload and verified; Reply was not clicked (dry-run).",
      });
      return;
    }

    waitForSelector(REPLY_SUBMIT, "wait for inline reply button");
    requireAb(["click", REPLY_SUBMIT], "submit inline reply");
    emit({ success: true, kind: "reply", sourcePostUrl });
  } catch (err) {
    emit({
      success: false,
      error: err?.message ?? String(err),
      errorCode: err?.errorCode ?? "unknown",
    });
  }
}

process.on("uncaughtException", (err) => {
  if (resultEmitted) return;
  emit({ success: false, error: err?.message ?? String(err), errorCode: "unknown" });
});

process.on("unhandledRejection", (reason) => {
  if (resultEmitted) return;
  emit({
    success: false,
    error: String(reason ?? "unhandled rejection"),
    errorCode: "unknown",
  });
});

main();
