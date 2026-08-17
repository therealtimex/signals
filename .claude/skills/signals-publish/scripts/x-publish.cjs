#!/usr/bin/env node
/**
 * Deterministic X publish via host agent-browser CLI (external skill dependency).
 *
 * Usage:
 *   node scripts/x-publish.cjs --port <cdpPort> --payload <job.json>
 *
 * Requires `agent-browser` on PATH (provisioned external skill).
 * stdout (last line): JSON result
 */
"use strict";

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const X_HOME_URL = "https://x.com/home";

const X_SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  loginButton: '[data-testid="loginButton"]',
  composeButton: '[data-testid="SideNav_NewTweet_Button"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  tweetTextarea: (index) => `[data-testid="tweetTextarea_${index}"]`,
  tweetButton: '[data-testid="tweetButton"]',
  addButton: '[data-testid="addButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachments: '[data-testid="attachments"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  desktopProfileLink: 'a[aria-label="Profile"]',
};

const X_LOGGED_IN_MARKERS = [
  X_SELECTORS.primaryColumn,
  X_SELECTORS.composeButton,
  X_SELECTORS.accountSwitcher,
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
];

const TWITTER_EPOCH_MS = 1288834974657;

function sleep(ms) {
  runAb(["wait", String(ms)]);
}

function emit(result) {
  const line = JSON.stringify(result);
  console.log(line);
  process.exit(result.success ? 0 : 1);
}

function runAb(args) {
  const result = spawnSync("agent-browser", ["--session", SESSION, ...args], {
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

function ensureAgentBrowser() {
  const probe = spawnSync("agent-browser", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    emit({
      success: false,
      error:
        "agent-browser CLI not found on PATH. Install or enable the agent-browser external skill before publishing.",
      errorCode: "unknown",
    });
  }
}

function parseArgs(argv) {
  let port = null;
  let payloadPath = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--payload") payloadPath = argv[++i];
  }
  if (!port || !payloadPath) {
    emit({
      success: false,
      error: "Usage: node x-publish.cjs --port <cdpPort> --payload <job.json>",
      errorCode: "unknown",
    });
  }
  return { port, payload: JSON.parse(readFileSync(payloadPath, "utf8")) };
}

function abBool(args) {
  const result = runAb(args);
  if (!result.ok) return false;
  return result.stdout.toLowerCase() === "true";
}

function abText(args) {
  const result = runAb(args);
  if (!result.ok) return null;
  return result.stdout;
}

function normalizeTweetText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractStatusIdFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/status\/(\d+)/);
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

function selectNewOwnedStatus(candidates, handle, expectedText, baseline) {
  const needle = normalizeTweetText(expectedText).slice(0, 80);
  if (!needle) return null;

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
    if (!normalizeTweetText(candidate.text).includes(needle)) continue;
    const createdAt = statusIdToTimestampMs(candidate.statusId);
    if (createdAt === null || createdAt < baseline.capturedAtMs) continue;
    return {
      success: true,
      handle,
      platformPostId: candidate.statusId,
      platformUrl: candidate.href.startsWith("http")
        ? candidate.href
        : `https://x.com${candidate.href}`,
    };
  }
  return null;
}

function isXLoginUrl(url) {
  const lower = String(url).toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/i/flow/login") ||
    lower.includes("/oauth") ||
    lower.includes("/account/access")
  );
}

function connectSession(port) {
  const connect = runAb(["connect", String(port)]);
  if (!connect.ok && /failed|refused|error/i.test(connect.combined)) {
    throw {
      message: `Failed to connect agent-browser to CDP port ${port}: ${connect.combined}`,
      errorCode: "unknown",
    };
  }
  runAb(["tab"]);
}

function isXLoggedInPage() {
  const url = abText(["get", "url"]) ?? "";
  if (isXLoginUrl(url)) return false;
  if (abBool(["is", "visible", X_SELECTORS.loginButton])) return false;
  for (const selector of X_LOGGED_IN_MARKERS) {
    const count = abText(["get", "count", selector]);
    if (count && Number(count) > 0) return true;
  }
  return false;
}

function assertXLoggedIn() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (isXLoggedInPage()) return;
    sleep(500);
  }
  throw {
    message: "X is not logged in on RealTimeX Browser.",
    errorCode: "session_expired",
  };
}

function detectXDisplayHandle() {
  for (const selector of [X_SELECTORS.profileLink, X_SELECTORS.desktopProfileLink]) {
    const href = abText(["get", "attr", "href", selector]);
    if (href?.startsWith("/") && !href.includes("/status/")) {
      const segment = href.replace(/^\//, "").split("/")[0];
      if (segment && !["home", "explore", "i"].includes(segment.toLowerCase())) {
        return segment.startsWith("@") ? segment : `@${segment}`;
      }
    }
  }
  return null;
}

function readProfileStatusCandidates(handle) {
  const profileHandle = handle.replace(/^@/, "");
  runAb(["open", `https://x.com/${profileHandle}`]);
  sleep(1000);

  const js = `(() => {
    function normalize(text) {
      return String(text || "").replace(/\\s+/g, " ").trim();
    }
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
    const handle = ${JSON.stringify(handle)};
    const articles = document.querySelectorAll("article");
    const ownedCandidates = [];
    for (let i = 0; i < Math.min(articles.length, 12); i++) {
      const article = articles[i];
      const text = normalize(article.innerText);
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

  const raw = abText(["eval", js]);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function captureProfileStatusBaseline(handle) {
  const candidates = readProfileStatusCandidates(handle);
  const statusIds = new Set(candidates.map((c) => c.statusId));
  return {
    statusIds,
    maxStatusId: maxStatusIdNumeric(statusIds),
    capturedAtMs: Date.now(),
  };
}

function uploadMedia(paths) {
  if (!paths?.length) return;
  const upload = runAb(["upload", X_SELECTORS.fileInput, ...paths]);
  if (!upload.ok) {
    throw { message: upload.combined || "Media upload failed.", errorCode: "upload_failed" };
  }
  runAb(["wait", X_SELECTORS.attachments]);
  sleep(1000);
}

function fillCompose(payload) {
  runAb(["open", X_HOME_URL]);
  sleep(1000);
  assertXLoggedIn();

  runAb(["wait", X_SELECTORS.composeButton]);
  const compose = runAb(["click", X_SELECTORS.composeButton]);
  if (!compose.ok) {
    throw { message: compose.combined || "Compose button click failed.", errorCode: "unknown" };
  }
  sleep(1000);

  const textarea0 = X_SELECTORS.tweetTextarea(0);
  runAb(["wait", textarea0]);
  const fill = runAb(["fill", textarea0, payload.text]);
  if (!fill.ok) {
    throw { message: fill.combined || "Failed to fill tweet text.", errorCode: "unknown" };
  }

  const mediaPaths = Array.isArray(payload.mediaPaths?.[0])
    ? payload.mediaPaths[0]
    : payload.mediaPaths;
  if (mediaPaths?.length) uploadMedia(mediaPaths);

  const threadTexts = payload.threadTexts ?? [];
  for (let i = 0; i < threadTexts.length; i++) {
    runAb(["click", X_SELECTORS.addButton]);
    sleep(800);
    const selector = X_SELECTORS.tweetTextarea(i + 1);
    runAb(["wait", selector]);
    runAb(["fill", selector, threadTexts[i]]);
    const threadMedia = Array.isArray(payload.mediaPaths?.[i + 1])
      ? payload.mediaPaths[i + 1]
      : undefined;
    if (threadMedia?.length) uploadMedia(threadMedia);
  }
}

function waitForVerifiedPost(expectedText, handle, baseline, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const candidates = readProfileStatusCandidates(handle);
    const match = selectNewOwnedStatus(candidates, handle, expectedText, baseline);
    if (match) return match;
    sleep(2000);
  }
  return {
    success: false,
    error: "No newly published post was detected on your X profile.",
    errorCode: "timeout",
  };
}

function main() {
  const { port, payload } = parseArgs(process.argv);
  ensureAgentBrowser();

  try {
    connectSession(port);

    runAb(["open", X_HOME_URL]);
    sleep(1000);
    assertXLoggedIn();

    const handle = payload.expectedHandle ?? detectXDisplayHandle();
    if (!handle) {
      emit({
        success: false,
        error: "Could not detect the logged-in X handle.",
        errorCode: "session_expired",
      });
      return;
    }

    const baseline = captureProfileStatusBaseline(handle);
    fillCompose(payload);

    runAb(["wait", X_SELECTORS.tweetButton]);
    const post = runAb(["click", X_SELECTORS.tweetButton]);
    if (!post.ok) {
      emit({
        success: false,
        error: post.combined || "Tweet button click failed.",
        errorCode: "unknown",
      });
      return;
    }
    sleep(2000);

    const result = waitForVerifiedPost(payload.text, handle, baseline);
    emit(result.success ? { ...result, handle } : result);
  } catch (err) {
    const message = err?.message ?? String(err);
    const errorCode =
      err?.errorCode ??
      (message.toLowerCase().includes("captcha") ? "captcha" : "unknown");
    emit({ success: false, error: message, errorCode });
  }
}

main();
