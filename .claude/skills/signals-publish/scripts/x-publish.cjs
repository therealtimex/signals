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

const { parseEvalJsonArray, parseEvalJsonValue } = require("./parse-eval-json-array.cjs");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const AB_PREFIX = process.env.AGENT_BROWSER_BIN_ARGS
  ? process.env.AGENT_BROWSER_BIN_ARGS.split(" ").filter(Boolean)
  : [];
const X_HOME_URL = "https://x.com/home";
const X_COMPOSE_POST_URL = "https://x.com/compose/post";
const TYPE_SETTLE_MS = 2500;
const THREAD_ADD_WAIT_MS = 1500;
const COMPOSE_WAIT_TIMEOUT_MS = 15_000;

const PAGE_ADD_BUTTON_CANDIDATES = [
  '[data-testid="addButton"]',
  'button[aria-label="Add post"]',
  'button[aria-label="添加帖子"]',
  '[aria-label="Add post"]',
];

const MODAL_ADD_BUTTON_CANDIDATES = [
  '[role="dialog"] [data-testid="addButton"]',
  '[role="dialog"] button[aria-label="Add post"]',
  '[role="dialog"] button[aria-label="添加帖子"]',
  '[role="dialog"] [aria-label="Add post"]',
];

const X_SELECTORS = {
  primaryColumn: '[data-testid="primaryColumn"]',
  loginButton: '[data-testid="loginButton"]',
  composeButton: '[data-testid="SideNav_NewTweet_Button"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  composeDialog: '[role="dialog"]',
  composeTweetTextarea: (index) =>
    `[role="dialog"] [data-testid="tweetTextarea_${index}"]`,
  composeTweetTextareaAny: '[role="dialog"] [data-testid^="tweetTextarea_"]',
  composeAddButton: '[role="dialog"] [data-testid="addButton"]',
  composeTweetButton: '[role="dialog"] [data-testid="tweetButton"]',
  composeFileInput: '[role="dialog"] input[data-testid="fileInput"]',
  tweetTextarea: (index) => `[data-testid="tweetTextarea_${index}"]`,
  tweetButton: '[data-testid="tweetButton"]',
  addButton: '[data-testid="addButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachments: '[role="dialog"] [data-testid="attachments"]',
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
  requireAb(["wait", String(ms)], "wait");
}

function abCount(selector) {
  const result = runAb(["get", "count", selector]);
  if (!result.ok) return 0;
  const count = Number(result.stdout);
  return Number.isFinite(count) ? count : 0;
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

function composeEditableSelectors(wrapperSelector) {
  return [
    `${wrapperSelector} [contenteditable="true"]`,
    `${wrapperSelector} div[role="textbox"]`,
    `${wrapperSelector} [data-contents="true"]`,
    `${wrapperSelector} .public-DraftEditor-content`,
    `${wrapperSelector} [data-testid*="RichText"]`,
    wrapperSelector,
  ];
}

function readComposeText(wrapperSelector) {
  const js = `(() => {
    const root = document.querySelector(${JSON.stringify(wrapperSelector)});
    if (!root) return JSON.stringify("");
    const editable =
      root.querySelector('[contenteditable="true"]') ||
      root.querySelector('[role="textbox"]') ||
      root.querySelector('[data-contents="true"]') ||
      root;
    return JSON.stringify(
      String(editable.innerText || editable.textContent || "")
        .replace(/\\s+/g, " ")
        .trim()
    );
  })()`;
  const raw = abText(["eval", js]);
  const value = parseEvalJsonValue(raw);
  return normalizeTweetText(String(value ?? ""));
}

function composeTextMatches(wrapperSelector, expected) {
  const needle = normalizeTweetText(expected).slice(0, 80);
  if (!needle) return true;
  return readComposeText(wrapperSelector).includes(needle);
}

function focusComposeEditable(wrapperSelector, context) {
  for (const sel of composeEditableSelectors(wrapperSelector)) {
    if (abCount(sel) > 0) {
      const focused = runAb(["focus", sel]);
      if (!focused.ok) {
        requireAb(["click", sel], `${context} focus editable`);
      }
      return sel;
    }
  }
  requireAb(["click", wrapperSelector], `${context} focus wrapper`);
  return wrapperSelector;
}

function focusComposeEditableEvalJs(wrapperSelector) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(wrapperSelector)});
    if (!root) return JSON.stringify({ ok: false });
    const editable =
      root.querySelector('[contenteditable="true"]') ||
      root.querySelector('[role="textbox"]') ||
      root.querySelector('[data-contents="true"]') ||
      root;
    editable.focus();
    return JSON.stringify({
      ok:
        editable === document.activeElement ||
        root.contains(document.activeElement),
    });
  })()`;
}

function insertComposeTextViaEval(wrapperSelector, text) {
  const js = `(() => {
    const root = document.querySelector(${JSON.stringify(wrapperSelector)});
    if (!root) return JSON.stringify({ ok: false, reason: "no_root" });
    const editable =
      root.querySelector('[contenteditable="true"]') ||
      root.querySelector('[role="textbox"]') ||
      root.querySelector('[data-contents="true"]') ||
      root;
    const payload = ${JSON.stringify(text)};
    editable.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {}
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, payload);
    } catch {}
    try {
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: payload,
        })
      );
      editable.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
    const normalized = String(editable.innerText || editable.textContent || "")
      .replace(/\\s+/g, " ")
      .trim();
    return JSON.stringify({ ok: inserted || normalized.length > 0, text: normalized });
  })()`;
  const raw = abText(["eval", js]);
  const parsed = parseEvalJsonValue(raw);
  if (!parsed) return false;
  const needle = normalizeTweetText(text).slice(0, 80);
  const actual = normalizeTweetText(String(parsed.text ?? ""));
  return actual.includes(needle);
}

function insertComposeTextViaClipboard(wrapperSelector, text, context) {
  focusComposeEditable(wrapperSelector, `${context} clipboard focus`);
  requireAb(["clipboard", "write", text], `${context} clipboard write`);
  requireAb(["clipboard", "paste"], `${context} clipboard paste`);
}

function typeIntoComposeTextarea(wrapperSelector, text, context) {
  focusComposeEditable(wrapperSelector, context);
  parseEvalJsonValue(abText(["eval", focusComposeEditableEvalJs(wrapperSelector)]));

  requireAb(["keyboard", "type", text], `${context} keyboard type`);
  sleep(400);

  if (!composeTextMatches(wrapperSelector, text) && insertComposeTextViaEval(wrapperSelector, text)) {
    sleep(400);
  }

  if (!composeTextMatches(wrapperSelector, text)) {
    insertComposeTextViaClipboard(wrapperSelector, text, context);
    sleep(400);
  }

  if (!composeTextMatches(wrapperSelector, text)) {
    focusComposeEditable(wrapperSelector, `${context} refocus`);
    requireAb(["press", "Control+a"], `${context} select all`);
    requireAb(["keyboard", "inserttext", text], `${context} inserttext`);
    sleep(400);
  }

  if (!composeTextMatches(wrapperSelector, text)) {
    for (const sel of composeEditableSelectors(wrapperSelector)) {
      if (abCount(sel) === 0) continue;
      requireAb(["click", sel], `${context} refocus editable`);
      const typed = runAb(["type", sel, text]);
      sleep(400);
      if (typed.ok && composeTextMatches(wrapperSelector, text)) break;
    }
  }

  if (!composeTextMatches(wrapperSelector, text)) {
    throw {
      message: `${context}: typed text did not commit to compose editor`,
      errorCode: "unknown",
    };
  }

  sleep(TYPE_SETTLE_MS);
}

function waitForAddButton(scope, context, timeoutMs = COMPOSE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of scope.addButtonCandidates) {
      if (abCount(selector) > 0) return selector;
    }
    sleep(300);
  }
  throw {
    message: `${context}: timed out waiting for thread add button`,
    errorCode: "timeout",
  };
}

function focusLastAddButtonEvalJs(candidates) {
  return `(() => {
    const queries = ${JSON.stringify(candidates)};
    let btn = null;
    for (const q of queries) {
      const found = document.querySelectorAll(q);
      if (found.length) btn = found[found.length - 1];
    }
    if (!btn) return JSON.stringify({ ok: false, reason: "no_add_button" });
    btn.focus();
    return JSON.stringify({ ok: document.activeElement === btn });
  })()`;
}

function abUrl() {
  const result = runAb(["get", "url"]);
  return result.ok ? result.stdout.trim() : "";
}

function isComposePageUrl(url = abUrl()) {
  return /\/compose\//i.test(url);
}

function buildComposeScope(mode) {
  if (mode === "page") {
    const addButtonCandidates = PAGE_ADD_BUTTON_CANDIDATES;
    return {
      mode,
      tweetTextarea: (index) => `[data-testid="tweetTextarea_${index}"]`,
      tweetTextareaAny: '[data-testid^="tweetTextarea_"]',
      addButtonCandidates,
      addButton: addButtonCandidates[0],
      tweetButton: '[data-testid="tweetButton"]',
      fileInput: 'input[data-testid="fileInput"]',
      attachments: '[data-testid="attachments"]',
    };
  }
  const addButtonCandidates = MODAL_ADD_BUTTON_CANDIDATES;
  return {
    mode: "modal",
    tweetTextarea: (index) =>
      `[role="dialog"] [data-testid="tweetTextarea_${index}"]`,
    tweetTextareaAny: '[role="dialog"] [data-testid^="tweetTextarea_"]',
    addButtonCandidates,
    addButton: addButtonCandidates[0],
    tweetButton: '[role="dialog"] [data-testid="tweetButton"]',
    fileInput: '[role="dialog"] input[data-testid="fileInput"]',
    attachments: '[role="dialog"] [data-testid="attachments"]',
  };
}

function detectComposeUiMode() {
  if (isComposePageUrl() && abCount(X_SELECTORS.tweetTextarea(0)) > 0) {
    return "page";
  }
  if (abCount(X_SELECTORS.composeTweetTextarea(0)) > 0) {
    return "modal";
  }
  return null;
}

function resolveComposeScope() {
  if (isComposePageUrl()) {
    sleep(500);
    const pageMode = detectComposeUiMode();
    if (pageMode === "page") return buildComposeScope("page");
  }

  requireAb(["open", X_COMPOSE_POST_URL], "open compose/post");
  sleep(1500);
  assertXLoggedIn();

  const deadline = Date.now() + COMPOSE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const mode = detectComposeUiMode();
    if (mode) return buildComposeScope(mode);
    sleep(300);
  }

  requireAb(["open", X_HOME_URL], "open X home for modal compose fallback");
  sleep(1000);
  waitForSelector(X_SELECTORS.composeButton, "wait for compose button");
  requireAb(["click", X_SELECTORS.composeButton], "open compose modal");
  sleep(1000);

  const modalDeadline = Date.now() + COMPOSE_WAIT_TIMEOUT_MS;
  while (Date.now() < modalDeadline) {
    if (abCount(X_SELECTORS.composeTweetTextarea(0)) > 0) {
      return buildComposeScope("modal");
    }
    sleep(300);
  }

  throw {
    message:
      "Compose textarea not found on compose/post or home modal. X UI may have drifted.",
    errorCode: "timeout",
  };
}

function activateComposeThreadAdd(scope, context) {
  const resolved = waitForAddButton(scope, context);
  const js = focusLastAddButtonEvalJs(scope.addButtonCandidates);
  const raw = abText(["eval", js]);
  const parsed = parseEvalJsonValue(raw);
  if (parsed?.ok) {
    requireAb(["press", "Enter"], `${context} activate add via Enter`);
  } else {
    requireAb(["click", resolved], context);
  }
  sleep(THREAD_ADD_WAIT_MS);
}

let activeComposeScope = null;

function emit(result) {
  const line = JSON.stringify(result);
  console.log(line);
  process.exit(result.success ? 0 : 1);
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

function ensureAgentBrowser() {
  const probeArgs = AB_PREFIX.length ? [...AB_PREFIX, "--version"] : ["--version"];
  const probe = spawnSync(AB_BIN, probeArgs, { encoding: "utf8" });
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
  let dryRun = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--payload") payloadPath = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  if (!port || !payloadPath) {
    emit({
      success: false,
      error: "Usage: node x-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]",
      errorCode: "unknown",
    });
  }
  return {
    port,
    payload: JSON.parse(readFileSync(payloadPath, "utf8")),
    dryRun,
  };
}

function abBool(args) {
  const result = runAb(args);
  if (!result.ok) return false;
  return result.stdout.toLowerCase() === "true";
}

function abText(args) {
  const result = requireAb(args, args.join(" "));
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
    throw {
      message: "Failed to parse agent-browser tab list JSON.",
      errorCode: "unknown",
    };
  }

  const tabs = parsed?.data?.tabs ?? [];
  const contentTabs = tabs.filter(isContentTab);
  if (!contentTabs.length) {
    throw {
      message:
        "No HTTP(S) content tab found in RealTimeX Browser. Open https://x.com in the signals-publish session before publishing.",
      errorCode: "unknown",
    };
  }

  const preferred =
    contentTabs.find((tab) => /x\.com|twitter\.com/i.test(String(tab.url))) ??
    contentTabs[0];

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

function isXLoggedInPage() {
  const urlResult = runAb(["get", "url"]);
  const url = urlResult.ok ? urlResult.stdout : "";
  if (isXLoginUrl(url)) return false;
  if (abBool(["is", "visible", X_SELECTORS.loginButton])) return false;
  for (const selector of X_LOGGED_IN_MARKERS) {
    const countResult = runAb(["get", "count", selector]);
    if (countResult.ok && Number(countResult.stdout) > 0) return true;
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
    const href = abText(["get", "attr", selector, "href"]);
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
  requireAb(["open", `https://x.com/${profileHandle}`], "open profile timeline");
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
  return parseEvalJsonArray(raw);
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

function uploadMedia(paths, scope) {
  if (!paths?.length) return;
  requireAb(["upload", scope.fileInput, ...paths], "upload media", "upload_failed");
  waitForSelector(scope.attachments, "wait for attachments");
  sleep(1000);
}

function fillCompose(payload) {
  activeComposeScope = resolveComposeScope();
  const scope = activeComposeScope;

  const textarea0 = scope.tweetTextarea(0);
  waitForSelector(textarea0, "wait for main tweet textarea");
  typeIntoComposeTextarea(textarea0, payload.text, "main tweet");

  const mediaPaths = Array.isArray(payload.mediaPaths?.[0])
    ? payload.mediaPaths[0]
    : payload.mediaPaths;
  if (mediaPaths?.length) uploadMedia(mediaPaths, scope);

  const threadTexts = payload.threadTexts ?? [];
  if (threadTexts.length > 0) {
    waitForAddButton(scope, "wait for thread add button after main tweet");
  }
  for (let i = 0; i < threadTexts.length; i++) {
    const threadIndex = i + 1;
    activateComposeThreadAdd(scope, `add thread tweet ${threadIndex + 1}`);
    const selector = scope.tweetTextarea(threadIndex);
    waitForSelector(selector, `wait for thread textarea ${threadIndex}`);
    typeIntoComposeTextarea(
      selector,
      threadTexts[i],
      `fill thread tweet ${threadIndex + 1}`
    );
    const threadMedia = Array.isArray(payload.mediaPaths?.[i + 1])
      ? payload.mediaPaths[i + 1]
      : undefined;
    if (threadMedia?.length) uploadMedia(threadMedia, scope);
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
  const { port, payload, dryRun } = parseArgs(process.argv);
  ensureAgentBrowser();

  try {
    connectSession(port);

    requireAb(["open", X_HOME_URL], "open X home after connect");
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

    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        handle,
        message:
          "Compose and thread fields populated; Tweet was not clicked (dry-run).",
      });
      return;
    }

    waitForSelector(activeComposeScope.tweetButton, "wait for tweet button");
    requireAb(["click", activeComposeScope.tweetButton], "click tweet button");
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
