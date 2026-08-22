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
const THREAD_ADD_WAIT_MS = 3500;
const COMPOSE_WAIT_TIMEOUT_MS = 15_000;

let activeComposeScope = null;
let resultEmitted = false;

function logPhase(message) {
  process.stderr.write(`x-publish: ${message}\n`);
}

function emit(result) {
  resultEmitted = true;
  const line = JSON.stringify(result);
  process.stdout.write(`${line}\n`);
  process.exit(result.success ? 0 : 1);
}

function emitFatal(message, errorCode = "unknown") {
  emit({ success: false, error: message, errorCode });
}

function normalizeThreadTexts(payload) {
  const raw = payload?.threadTexts;
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => String(entry)).filter((entry) => entry.trim());
}

function normalizeKind(payload) {
  const kind = payload?.kind;
  if (kind === "repost" || kind === "quote") return kind;
  return "original";
}

function resolvePayloadSourceUrl(payload) {
  const url = String(payload?.sourcePostUrl ?? "").trim();
  if (url) return url;
  const id = String(payload?.sourcePostId ?? "").trim();
  if (!id) return null;
  return `https://x.com/i/status/${id}`;
}

function validatePayload(payload) {
  const kind = normalizeKind(payload);
  if (kind === "original") {
    if (!String(payload?.text ?? "").trim()) {
      throw {
        message: "payload.text is required and must be non-empty",
        errorCode: "unknown",
      };
    }
  } else {
    if (!resolvePayloadSourceUrl(payload)) {
      throw {
        message: "payload.sourcePostUrl or payload.sourcePostId is required for repost/quote jobs",
        errorCode: "unknown",
      };
    }
    if (kind === "quote" && !String(payload?.text ?? "").trim()) {
      throw {
        message: "payload.text is required for quote-post jobs",
        errorCode: "unknown",
      };
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(payload ?? {}, "expectedHandle") &&
    !String(payload.expectedHandle ?? "").trim()
  ) {
    throw {
      message: "payload.expectedHandle must be non-empty when supplied",
      errorCode: "wrong_account",
    };
  }
  if (payload?.threadText != null && payload.threadTexts == null) {
    throw {
      message:
        "payload.threadTexts array is required for thread posts (found legacy threadText field)",
      errorCode: "unknown",
    };
  }
}

const ADD_BUTTON_CANDIDATES_DIALOG = [
  '[role="dialog"] [data-testid="addButton"]',
  '[role="dialog"] button[aria-label="Add post"]',
  '[role="dialog"] button[aria-label="添加帖子"]',
  '[role="dialog"] [aria-label="Add post"]',
];

const ADD_BUTTON_CANDIDATES_PAGE = [
  ...ADD_BUTTON_CANDIDATES_DIALOG,
  '[data-testid="addButton"]',
  'button[aria-label="Add post"]',
  'button[aria-label="添加帖子"]',
  '[aria-label="Add post"]',
];

const MODAL_ADD_BUTTON_CANDIDATES = ADD_BUTTON_CANDIDATES_PAGE;

const PAGE_ADD_BUTTON_CANDIDATES = ADD_BUTTON_CANDIDATES_PAGE;

function addButtonCountAvailable(scope) {
  for (const selector of scope.addButtonCandidates) {
    if (abCount(selector) > 0) return true;
  }
  return false;
}

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

function readComposeText(wrapperSelector, scope = activeComposeScope) {
  const indexMatch =
    wrapperSelector.match(/signals-publish-thread-(\d+)/) ||
    wrapperSelector.match(/tweetTextarea_(\d+)/);
  const index = indexMatch ? Number(indexMatch[1]) : 0;
  const zeroSelector = scope
    ? threadTextareaZeroSelector(scope)
    : '[data-testid="tweetTextarea_0"]';
  const js = `(() => {
    const numbered = document.querySelector(${JSON.stringify(wrapperSelector)});
    const zeros = document.querySelectorAll(${JSON.stringify(zeroSelector)});
    const root = numbered || zeros[${index}] || null;
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
      requireAb(["click", sel], `${context} focus editable`);
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

function focusAddButtonEval(scope) {
  return parseEvalJsonValue(
    abText(["eval", focusLastAddButtonEvalJs(scope.addButtonCandidates)])
  );
}

function waitForFocusableAddButton(scope, context, timeoutMs = COMPOSE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (addButtonCountAvailable(scope)) return { ok: true, via: "count" };
    const parsed = focusAddButtonEval(scope);
    if (parsed?.ok) return parsed;
    sleep(300);
  }
  throw {
    message: `${context}: timed out waiting for focusable thread add button`,
    errorCode: "timeout",
  };
}

function activateAddKeyboardEvalJs(candidates) {
  return `(() => {
    const queries = ${JSON.stringify(candidates)};
    let btn = null;
    for (const q of queries) {
      const found = document.querySelectorAll(q);
      if (found.length) btn = found[found.length - 1];
    }
    if (!btn) return JSON.stringify({ ok: false, reason: "no_add_button" });
    try {
      btn.focus();
    } catch {}
    try {
      btn.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      btn.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
    } catch {}
    return JSON.stringify({ ok: true, via: "keyboard_eval" });
  })()`;
}

function focusComposeAddButton(scope) {
  for (const selector of scope.addButtonCandidates) {
    if (abCount(selector) > 0) {
      runAb(["focus", selector]);
      return selector;
    }
  }
  const parsed = focusAddButtonEval(scope);
  if (parsed?.ok) {
    for (const selector of scope.addButtonCandidates) {
      if (abCount(selector) > 0) return selector;
    }
    return scope.addButton;
  }
  return null;
}

function activateAddViaA11y(scope, context) {
  const focused = focusComposeAddButton(scope);
  if (!focused && !addButtonCountAvailable(scope)) {
    throw {
      message: `${context}: could not find add post button for a11y activation`,
      errorCode: "timeout",
    };
  }
  sleep(300);
  // X rejects programmatic addButton clicks (resets composer). Screen-reader path: focus + Enter.
  const pressed = runAb(["press", "Enter"]);
  if (!pressed.ok) {
    const evalParsed = parseEvalJsonValue(
      abText(["eval", activateAddKeyboardEvalJs(scope.addButtonCandidates)])
    );
    if (!evalParsed?.ok) {
      throw {
        message: `${context}: Enter activation failed for add post button`,
        errorCode: "unknown",
      };
    }
  }
  sleep(400);
  if (focused) {
    runAb(["focus", focused]);
    sleep(200);
    runAb(["press", "Space"]);
    sleep(400);
  }
}

function ensureMainTweetCommitted(scope, text, context) {
  if (!text) return;
  const selector = scope.tweetTextarea(0);
  if (composeTextMatches(selector, text)) return;
  typeIntoComposeTextarea(selector, text, `${context} restore main tweet`);
  waitForFocusableAddButton(scope, `${context} wait for add after main restore`);
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
    try {
      btn.focus();
    } catch {}
    return JSON.stringify({
      ok: true,
      focused: document.activeElement === btn,
    });
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
  const addButtonCandidates = ADD_BUTTON_CANDIDATES_PAGE;
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
  if (abCount(X_SELECTORS.composeTweetTextarea(0)) > 0) {
    return "modal";
  }
  if (abCount(X_SELECTORS.tweetTextarea(0)) > 0) {
    return "page";
  }
  return null;
}

function resolveComposeScope() {
  if (isComposePageUrl()) {
    sleep(500);
    const mode = detectComposeUiMode();
    if (mode) return buildComposeScope(mode);
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

function threadTextareaZeroSelector(scope) {
  return scope.mode === "page"
    ? '[data-testid="tweetTextarea_0"]'
    : '[role="dialog"] [data-testid="tweetTextarea_0"]';
}

function threadTextareaReady(scope, threadIndex) {
  if (abCount(scope.tweetTextarea(threadIndex)) > 0) return true;
  // Thread slots must use tweetTextarea_1, tweetTextarea_2, … — never duplicate tweetTextarea_0.
  if (threadIndex === 0) {
    return abCount(threadTextareaZeroSelector(scope)) > 0;
  }
  return false;
}

function markThreadTextareaViaEval(scope, threadIndex) {
  if (threadIndex === 0) {
    const numbered = scope.tweetTextarea(0);
    if (abCount(numbered) > 0) return numbered;
  }
  return null;
}

function resolveThreadTextareaSelector(scope, threadIndex) {
  const numbered = scope.tweetTextarea(threadIndex);
  if (abCount(numbered) > 0) return numbered;
  if (threadTextareaReady(scope, threadIndex)) {
    const marked = markThreadTextareaViaEval(scope, threadIndex);
    if (marked) return marked;
  }
  return numbered;
}

function waitForThreadTextarea(scope, threadIndex, context) {
  const deadline = Date.now() + COMPOSE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const selector = resolveThreadTextareaSelector(scope, threadIndex);
    if (abCount(selector) > 0) return selector;
    sleep(300);
  }
  throw {
    message: `${context}: timed out waiting for thread textarea ${threadIndex}`,
    errorCode: "timeout",
  };
}

function collectComposeSlotsEvalJs(scope) {
  const rootExpr =
    scope.mode === "modal"
      ? "document.querySelector('[role=\"dialog\"]')"
      : "document.body";
  return `(() => {
    const root = ${rootExpr};
    if (!root) return JSON.stringify({ ok: false, reason: "no_compose_root" });
    const nodes = root.querySelectorAll('[data-testid^="tweetTextarea_"]');
    const slots = [];
    for (const node of nodes) {
      const testId = node.getAttribute("data-testid") || "";
      const m = testId.match(/^tweetTextarea_(\\d+)$/);
      if (!m) continue;
      const editable =
        node.querySelector('[contenteditable="true"]') ||
        node.querySelector('[role="textbox"]') ||
        node.querySelector('[data-contents="true"]') ||
        node;
      const text = String(editable.innerText || editable.textContent || "")
        .replace(/\\s+/g, " ")
        .trim();
      slots.push({ testId, index: Number(m[1]), text });
    }
    return JSON.stringify({ ok: true, slots });
  })()`;
}

function collectComposeSlots(scope) {
  const parsed = parseEvalJsonValue(abText(["eval", collectComposeSlotsEvalJs(scope)]));
  if (!parsed?.ok || !Array.isArray(parsed.slots)) {
    throw {
      message: "Could not read compose textarea slots from X UI.",
      errorCode: "unknown",
    };
  }
  return parsed.slots;
}

function validateComposeState(scope, payload) {
  const slots = collectComposeSlots(scope);
  const byIndex = new Map();
  const duplicateTestIds = new Set();
  const testIdCounts = new Map();

  for (const slot of slots) {
    testIdCounts.set(slot.testId, (testIdCounts.get(slot.testId) || 0) + 1);
    if (!byIndex.has(slot.index)) byIndex.set(slot.index, []);
    byIndex.get(slot.index).push(slot);
  }

  for (const [testId, count] of testIdCounts.entries()) {
    if (count > 1) duplicateTestIds.add(testId);
  }

  const mainNeedle = normalizeTweetText(payload.text).slice(0, 80);
  const threadTexts = normalizeThreadTexts(payload);
  const errors = [];

  if (duplicateTestIds.size > 0) {
    errors.push(
      `duplicate compose testids: ${[...duplicateTestIds].join(", ")}`
    );
  }

  const slot0 = byIndex.get(0)?.[0];
  if (!slot0 || !normalizeTweetText(slot0.text).includes(mainNeedle)) {
    errors.push("main tweet missing from tweetTextarea_0");
  }

  for (let i = 0; i < threadTexts.length; i++) {
    const threadIndex = i + 1;
    const threadNeedle = normalizeTweetText(threadTexts[i]).slice(0, 80);
    const numberedSlots = byIndex.get(threadIndex) || [];
    if (numberedSlots.length === 0) {
      errors.push(`tweetTextarea_${threadIndex} not found`);
      continue;
    }
    if (numberedSlots.length > 1) {
      errors.push(`tweetTextarea_${threadIndex} is duplicated`);
    }
    const threadText = normalizeTweetText(numberedSlots[0].text);
    if (!threadText.includes(threadNeedle)) {
      errors.push(`thread slot ${threadIndex} text mismatch`);
    }
    if (mainNeedle && threadText.includes(mainNeedle) && threadNeedle !== mainNeedle) {
      errors.push(`thread slot ${threadIndex} duplicates main tweet text`);
    }
  }

  if (slot0 && threadTexts.length > 0) {
    const mainText = normalizeTweetText(slot0.text);
    const firstThreadNeedle = normalizeTweetText(threadTexts[0]).slice(0, 80);
    if (firstThreadNeedle && mainText.includes(firstThreadNeedle)) {
      errors.push("main tweetTextarea_0 contains continuation text");
    }
  }

  if (errors.length > 0) {
    throw {
      message: `Compose validation failed: ${errors.join("; ")}`,
      errorCode: "compose_invalid",
    };
  }

  return { slots, slotCount: slots.length };
}

function openXHomeResilient() {
  const currentUrl = abUrl();
  if (/x\.com|twitter\.com/i.test(currentUrl) && isXLoggedInPage()) {
    return;
  }
  const result = runAb(["open", X_HOME_URL]);
  if (!result.ok) {
    if (/ERR_ABORTED/i.test(result.combined) && isXLoggedInPage()) {
      return;
    }
    throw {
      message: `open X home after connect: ${result.combined || "agent-browser command failed"}`,
      errorCode: "unknown",
    };
  }
}

function activateComposeThreadAdd(scope, context, threadIndex, mainTweetText) {
  waitForFocusableAddButton(scope, context);
  const deadline = Date.now() + COMPOSE_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (threadTextareaReady(scope, threadIndex)) return;

    activateAddViaA11y(scope, context);
    sleep(THREAD_ADD_WAIT_MS);
    if (threadTextareaReady(scope, threadIndex)) return;

    ensureMainTweetCommitted(scope, mainTweetText, context);
    sleep(500);
  }

  throw {
    message: `${context}: thread compose slot did not appear after a11y add activation`,
    errorCode: "compose_invalid",
  };
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
  const threadTexts = normalizeThreadTexts(payload);
  logPhase(`fillCompose threadSlots=${threadTexts.length}`);
  activeComposeScope = resolveComposeScope();
  const scope = activeComposeScope;

  const textarea0 = scope.tweetTextarea(0);
  waitForSelector(textarea0, "wait for main tweet textarea");
  typeIntoComposeTextarea(textarea0, payload.text, "main tweet");

  const mediaPaths = Array.isArray(payload.mediaPaths?.[0])
    ? payload.mediaPaths[0]
    : payload.mediaPaths;
  if (mediaPaths?.length) uploadMedia(mediaPaths, scope);

  if (threadTexts.length > 0) {
    waitForFocusableAddButton(scope, "wait for thread add button after main tweet");
  }
  for (let i = 0; i < threadTexts.length; i++) {
    const threadIndex = i + 1;
    activateComposeThreadAdd(
      scope,
      `add thread tweet ${threadIndex + 1}`,
      threadIndex,
      payload.text
    );
    const selector = waitForThreadTextarea(
      scope,
      threadIndex,
      `wait for thread textarea ${threadIndex}`
    );
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

  validateComposeState(scope, { ...payload, threadTexts });
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

function runRepostOrQuote({ payload, kind, handle, dryRun }) {
  const sourceUrl = resolvePayloadSourceUrl(payload);
  requireAb(["open", sourceUrl], "open source post");
  sleep(2000);
  waitForSelector('[data-testid="retweet"]', "wait for repost button on source post");
  requireAb(["click", '[data-testid="retweet"]'], "open repost menu");
  sleep(500);

  if (kind === "repost") {
    waitForSelector('[data-testid="retweetConfirm"]', "wait for repost confirm");
    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        handle,
        kind,
        message: "Repost menu opened; confirm not clicked (dry-run).",
      });
      return;
    }
    requireAb(["click", '[data-testid="retweetConfirm"]'], "confirm repost");
    sleep(1500);
    const postId = extractStatusIdFromHref(sourceUrl);
    emit({
      success: true,
      handle,
      kind,
      platformPostId: postId ?? undefined,
      platformUrl: sourceUrl,
    });
    return;
  }

  waitForSelector('[data-testid="quoteTweet"]', "wait for quote option");
  requireAb(["click", '[data-testid="quoteTweet"]'], "open quote compose");
  sleep(1000);
  activeComposeScope = resolveComposeScope();
  fillCompose({ ...payload, threadTexts: [] });

  if (dryRun) {
    emit({
      success: true,
      dryRun: true,
      handle,
      kind,
      message: "Quote compose filled; Tweet was not clicked (dry-run).",
    });
    return;
  }

  const baseline = captureProfileStatusBaseline(handle);
  waitForSelector(activeComposeScope.tweetButton, "wait for quote tweet button");
  requireAb(["click", activeComposeScope.tweetButton], "click quote tweet button");
  sleep(2000);

  const result = waitForVerifiedPost(payload.text, handle, baseline);
  emit(result.success ? { ...result, handle, kind: "quote" } : result);
}

function main() {
  const { port, payload, dryRun } = parseArgs(process.argv);
  ensureAgentBrowser();

  try {
    validatePayload(payload);
    logPhase(`start dryRun=${dryRun}`);
    connectSession(port);

    openXHomeResilient();
    sleep(1000);
    assertXLoggedIn();

    const detectedHandle = detectXDisplayHandle();
    if (!detectedHandle) {
      emit({
        success: false,
        error: "Could not detect the logged-in X handle.",
        errorCode: "session_expired",
      });
      return;
    }
    const expectedHandle = payload.expectedHandle;
    if (
      expectedHandle &&
      String(expectedHandle).replace(/^@/, "").toLowerCase() !==
        String(detectedHandle).replace(/^@/, "").toLowerCase()
    ) {
      emit({
        success: false,
        error: `Wrong X account active: expected ${expectedHandle}, detected ${detectedHandle}`,
        errorCode: "wrong_account",
        expectedHandle,
        detectedHandle,
      });
      return;
    }
    const handle = expectedHandle ?? detectedHandle;

    const kind = normalizeKind(payload);
    if (kind !== "original") {
      runRepostOrQuote({ payload, kind, handle, dryRun });
      return;
    }

    const baseline = dryRun ? null : captureProfileStatusBaseline(handle);
    fillCompose(payload);

    const normalizedPayload = {
      ...payload,
      threadTexts: normalizeThreadTexts(payload),
    };

    if (dryRun) {
      const composeCheck = validateComposeState(
        activeComposeScope,
        normalizedPayload
      );
      emit({
        success: true,
        dryRun: true,
        handle,
        composeSlots: composeCheck.slotCount,
        threadSlots: normalizedPayload.threadTexts.length,
        message:
          "Compose and thread fields populated and validated; Tweet was not clicked (dry-run).",
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

process.on("uncaughtException", (err) => {
  if (resultEmitted) return;
  emitFatal(err?.message ?? String(err), "unknown");
});

process.on("unhandledRejection", (reason) => {
  if (resultEmitted) return;
  emitFatal(String(reason ?? "unhandled rejection"), "unknown");
});

main();
