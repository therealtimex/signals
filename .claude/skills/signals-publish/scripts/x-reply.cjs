#!/usr/bin/env node
/**
 * Deterministic X reply via host agent-browser CLI.
 *
 * After Reply, prefers the visible reply dialog composer when it exists
 * (`[role="dialog"] [data-testid="tweetTextarea_0"]` + scoped tweetButton).
 * Falls back to the inline composer + tweetButtonInline. Injects the entire
 * reply with one CDP Input.insertText (`agent-browser keyboard inserttext`),
 * re-injects once on snapshot mismatch, then refuses to click Tweet unless
 * the Draft.js/Lexical snapshot matches. After click, waits for a newly
 * created owned reply and returns its platformPostId / platformUrl.
 *
 * Usage:
 *   node scripts/x-reply.cjs --port <cdpPort> --payload <reply.json> [--dry-run]
 *
 * Payload: { "text": "...", "sourcePostUrl": "https://x.com/.../status/..." }
 */
"use strict";

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const { parseEvalJsonArray, parseEvalJsonValue } = require("./parse-eval-json-array.cjs");
const {
  matchComposeSnapshot,
  publishedReplyMatches,
  readComposeSnapshotEvalJs,
  selectComposeContentsEvalJs,
} = require("./x-compose-text.cjs");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const AB_PREFIX = process.env.AGENT_BROWSER_BIN_ARGS
  ? process.env.AGENT_BROWSER_BIN_ARGS.split(" ").filter(Boolean)
  : [];
const COMPOSE_WAIT_TIMEOUT_MS = 15_000;
const TYPE_SETTLE_MS = 800;
const COMPOSE_REINJECT_ATTEMPTS = 2;
const TWITTER_EPOCH_MS = 1288834974657;

const REPLY_TEXTAREA = '[data-testid="tweetTextarea_0"]';
const REPLY_TEXTAREA_MODAL = '[role="dialog"] [data-testid="tweetTextarea_0"]';
const REPLY_BUTTON = '[data-testid="reply"]';
const REPLY_SUBMIT = '[data-testid="tweetButtonInline"]';
const REPLY_SUBMIT_MODAL = '[role="dialog"] [data-testid="tweetButton"]';
const PROFILE_LINK = '[data-testid="AppTabBar_Profile_Link"]';
const DESKTOP_PROFILE_LINK = 'a[aria-label="Profile"]';

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

function abText(args) {
  return requireAb(args, args.join(" ")).stdout;
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

function detectXDisplayHandle() {
  for (const selector of [PROFILE_LINK, DESKTOP_PROFILE_LINK]) {
    const href = runAb(["get", "attr", selector, "href"]).stdout;
    if (href?.startsWith("/") && !href.includes("/status/")) {
      const segment = href.replace(/^\//, "").split("/")[0];
      if (segment && !["home", "explore", "i"].includes(segment.toLowerCase())) {
        return segment.startsWith("@") ? segment : `@${segment}`;
      }
    }
  }
  return null;
}

function waitForReplyComposer(timeoutMs = COMPOSE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let inlineHits = 0;
  while (Date.now() < deadline) {
    if (abCount(REPLY_TEXTAREA_MODAL) > 0) {
      return {
        mode: "modal",
        textarea: REPLY_TEXTAREA_MODAL,
        submit: REPLY_SUBMIT_MODAL,
      };
    }
    if (abCount(REPLY_TEXTAREA) > 0) {
      inlineHits += 1;
      // The inline box stays in the page when Reply opens a dialog. Wait one
      // extra tick so a just-opened modal can mount before we click the
      // covered inline textarea.
      if (inlineHits >= 2) {
        return {
          mode: "inline",
          textarea: REPLY_TEXTAREA,
          submit: REPLY_SUBMIT,
        };
      }
    }
    sleep(300);
  }
  throw {
    message: `timed out waiting for ${REPLY_TEXTAREA_MODAL} or ${REPLY_TEXTAREA}`,
    errorCode: "timeout",
  };
}

function insertReplyText(surface, text, context = "CDP inserttext") {
  requireAb(["click", surface.textarea], `focus ${surface.mode} reply composer`);
  parseEvalJsonValue(abText(["eval", selectComposeContentsEvalJs(surface.textarea)]));
  requireAb(["keyboard", "inserttext", text], context);
}

function readReplySnapshot(surface) {
  const raw = requireAb(
    ["eval", readComposeSnapshotEvalJs(surface.textarea)],
    "read compose snapshot"
  ).stdout;
  const parsed = parseEvalJsonValue(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function fillReplyAndAssert(surface, text) {
  let lastMatch = { ok: false, reason: "not_attempted", expected: text, actual: "" };
  for (let attempt = 1; attempt <= COMPOSE_REINJECT_ATTEMPTS; attempt++) {
    const context =
      attempt === 1 ? "CDP inserttext" : "CDP inserttext re-inject";
    insertReplyText(surface, text, context);
    sleep(TYPE_SETTLE_MS);
    lastMatch = matchComposeSnapshot(readReplySnapshot(surface), text);
    if (lastMatch.ok) return;
  }
  throw {
    message: `pre-submit compose editor does not contain the full drafted reply after ${COMPOSE_REINJECT_ATTEMPTS} insert attempts (${lastMatch.reason}; expected ${JSON.stringify(lastMatch.expected)}, actual ${JSON.stringify(lastMatch.actual)})`,
    errorCode: "compose_invalid",
  };
}

function waitForReplySubmitSelector(surface, timeoutMs = COMPOSE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (abCount(surface.submit) > 0) return surface.submit;
    sleep(300);
  }
  throw {
    message: `timed out waiting for ${surface.submit}`,
    errorCode: "timeout",
  };
}

function extractStatusIdFromHref(href) {
  if (!href) return null;
  const match = String(href).match(/\/status\/(\d+)/);
  return match?.[1] ?? null;
}

function isStatusOwnedByHandle(href, handle) {
  const clean = handle.replace(/^@/, "").toLowerCase();
  try {
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const match = path.match(/^\/([^/]+)\/status\/(\d+)/);
    return match?.[1]?.toLowerCase() === clean;
  } catch {
    return false;
  }
}

function maxStatusIdNumeric(statusIds) {
  let max = 0n;
  for (const id of statusIds) {
    try {
      const value = BigInt(id);
      if (value > max) max = value;
    } catch {
      // ignore
    }
  }
  return max;
}

function statusIdToTimestampMs(statusId) {
  try {
    return Number(BigInt(statusId) >> 22n) + TWITTER_EPOCH_MS;
  } catch {
    return null;
  }
}

function ownedRepliesUrl(handle) {
  return `https://x.com/${String(handle).replace(/^@/, "")}/with_replies`;
}

function selectNewOwnedStatus(candidates, handle, expectedText, baseline) {
  const want = String(expectedText ?? "");
  if (!want.trim()) return null;

  for (const candidate of candidates) {
    if (baseline.statusIds.has(candidate.statusId)) continue;
    let candidateId;
    try {
      candidateId = BigInt(candidate.statusId);
    } catch {
      continue;
    }
    if (candidateId <= baseline.maxStatusId) continue;
    if (!isStatusOwnedByHandle(candidate.href, handle)) continue;
    if (!publishedReplyMatches(candidate.text, want)) continue;
    const createdAt = statusIdToTimestampMs(candidate.statusId);
    if (createdAt === null || createdAt < baseline.capturedAtMs) continue;
    return {
      success: true,
      handle,
      kind: "reply",
      platformPostId: candidate.statusId,
      platformUrl: candidate.href.startsWith("http")
        ? candidate.href
        : `https://x.com${candidate.href}`,
    };
  }
  return null;
}

function readOwnedStatusCandidates(handle) {
  const js = `(() => {
    function extractStatusId(href) {
      if (!href) return null;
      const match = href.match(/\\/status\\/(\\d+)/);
      return match ? match[1] : null;
    }
    function owned(href, handle) {
      const clean = handle.replace(/^@/, "").toLowerCase();
      try {
        const path = href.startsWith("http") ? new URL(href).pathname : href;
        const match = path.match(/^\\/([^/]+)\\/status\\/(\\d+)/);
        return match && match[1].toLowerCase() === clean;
      } catch {
        return false;
      }
    }
    function tweetBody(article) {
      const node = article.querySelector('[data-testid="tweetText"]');
      return String((node && (node.innerText || node.textContent)) || "");
    }
    const handle = ${JSON.stringify(handle)};
    const articles = document.querySelectorAll("article");
    const ownedCandidates = [];
    for (let i = 0; i < Math.min(articles.length, 24); i++) {
      const article = articles[i];
      const text = tweetBody(article);
      const links = article.querySelectorAll("a[href*='/status/']");
      for (const link of links) {
        const href = link.getAttribute("href");
        const statusId = extractStatusId(href);
        if (!href || !statusId) continue;
        if (owned(href, handle)) {
          ownedCandidates.push({ statusId, href, text });
          break;
        }
      }
    }
    return JSON.stringify(ownedCandidates);
  })()`;
  return parseEvalJsonArray(abText(["eval", js]));
}

function captureStatusBaseline(handle, sourcePostUrl) {
  requireAb(["open", ownedRepliesUrl(handle)], "open owned replies timeline for baseline");
  sleep(400);
  const candidates = readOwnedStatusCandidates(handle);
  const statusIds = new Set(candidates.map((c) => c.statusId));
  const sourceId = extractStatusIdFromHref(sourcePostUrl);
  if (sourceId) statusIds.add(sourceId);
  return {
    statusIds,
    maxStatusId: maxStatusIdNumeric(statusIds),
    capturedAtMs: Date.now(),
  };
}

function waitForVerifiedReply(expectedText, handle, baseline) {
  const budgetMs = Number(process.env.SIGNALS_PUBLISH_VERIFY_TIMEOUT_MS ?? 20_000);
  const pollMs = Math.min(2000, Math.max(50, budgetMs));
  const repliesUrl = ownedRepliesUrl(handle);
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    requireAb(["open", repliesUrl], "refresh owned replies timeline");
    sleep(Math.min(400, pollMs));
    const match = selectNewOwnedStatus(
      readOwnedStatusCandidates(handle),
      handle,
      expectedText,
      baseline
    );
    if (match) return match;
    sleep(pollMs);
  }
  return {
    success: false,
    submitted: true,
    error: `Reply was clicked but the full drafted text was not confirmed on ${repliesUrl}. Do not click Reply again.`,
    errorCode: "verify_uncertain",
  };
}

function main() {
  const { port, payload, dryRun } = parseArgs(process.argv);
  try {
    const { text, sourcePostUrl } = validatePayload(payload);
    connectSession(port);
    requireAb(["open", sourcePostUrl], "open source post");
    sleep(1000);
    const handle = detectXDisplayHandle();
    if (!handle) {
      throw {
        message: "Could not detect the logged-in X handle before sending the reply.",
        errorCode: "session_expired",
      };
    }
    const baseline = dryRun ? null : captureStatusBaseline(handle, sourcePostUrl);
    requireAb(["open", sourcePostUrl], "return to source post");
    sleep(1000);
    waitForSelector(REPLY_BUTTON, "wait for reply button");
    requireAb(["click", REPLY_BUTTON], "open reply composer");
    const surface = waitForReplyComposer();
    fillReplyAndAssert(surface, text);

    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        kind: "reply",
        handle,
        composeMode: surface.mode,
        message:
          `${surface.mode === "modal" ? "Modal" : "Inline"} reply filled with one CDP inserttext payload and verified; Reply was not clicked (dry-run).`,
      });
      return;
    }

    const submitSelector = waitForReplySubmitSelector(surface);
    requireAb(["click", submitSelector], "submit reply");
    sleep(2000);
    const result = waitForVerifiedReply(text, handle, baseline);
    if (!result.success) {
      emit(result);
      return;
    }
    emit({ ...result, sourcePostUrl });
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
