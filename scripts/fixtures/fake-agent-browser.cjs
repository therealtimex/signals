#!/usr/bin/env node
/**
 * Stateful fake agent-browser CLI for x-publish adapter tests.
 * Persists state in FAKE_AB_STATE_FILE between invocations.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const profileHandle = "smokeuser";
const stateFile =
  process.env.FAKE_AB_STATE_FILE ||
  path.join(os.tmpdir(), `fake-agent-browser-${process.env.SIGNALS_PUBLISH_AB_SESSION || "default"}.json`);

function defaultState() {
  return {
    activeTab: "t1",
    postPublished: false,
    composeOpen: false,
    composeUiMode: "page",
    mainTweetTyped: false,
    mainTweetText: "",
    composedTextByIndex: {},
    activeTextareaIndex: 0,
    lastSelector: "",
    threadTextareaCount: 0,
  };
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state));
}

function jsonOut(data) {
  console.log(JSON.stringify(data));
}

function ok(text = "") {
  if (text) console.log(text);
  process.exit(0);
}

function fail(text) {
  console.error(text);
  process.exit(1);
}

function parseArgv(argv) {
  const args = argv.slice(2);
  if (args[0] === "--version") {
    ok("fake-agent-browser 0.27.0");
  }

  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session") {
      i += 1;
      continue;
    }
    rest.push(args[i]);
  }
  return rest;
}

function shellTab(state) {
  return {
    active: state.activeTab === "t1",
    label: null,
    tabId: "t1",
    title: "RealTimeX Browser",
    type: "page",
    url: "devtools://devtools/bundled/devtools_app.html",
  };
}

function contentTab(state) {
  const url = state.composeOpen
    ? "https://x.com/compose/post"
    : "https://x.com/home";
  return {
    active: state.activeTab === "t2",
    label: null,
    tabId: "t2",
    title: state.composeOpen ? "Compose / X" : "Home / X",
    type: "page",
    url,
  };
}

function tabListJson(state) {
  jsonOut({
    success: true,
    data: { tabs: [shellTab(state), contentTab(state)] },
    error: null,
  });
}

const LOGGED_IN_MARKERS = [
  "primaryColumn",
  "SideNav_NewTweet_Button",
  "SideNav_AccountSwitcher_Button",
  "AppTabBar_Profile_Link",
  "aria-label=\"Profile\"",
];

function textareaCountForSelector(selector, state) {
  if (LOGGED_IN_MARKERS.some((marker) => selector.includes(marker))) {
    return 1;
  }
  const isDialogScoped =
    selector.includes("role=\"dialog\"") || selector.includes('[role="dialog"]');
  if (state.composeOpen && state.composeUiMode === "page") {
    if (isDialogScoped && selector.includes("tweetTextarea")) {
      return 0;
    }
    if (
      selector.includes("tweetTextarea_0") &&
      !selector.includes("tweetTextarea_1") &&
      !isDialogScoped
    ) {
      return state.threadTextareaCount > 0 ? 1 : 0;
    }
  }
  if (!state.composeOpen) {
    if (selector.includes("tweetTextarea_0") && !selector.includes("tweetTextarea_1")) {
      return 0;
    }
    return 0;
  }
  if (process.env.FAKE_AB_DUPLICATE_TEXTAREA_0 === "1") {
    if (selector.includes("tweetTextarea_1")) {
      return 0;
    }
    if (
      selector.includes("tweetTextarea_0") &&
      !selector.includes("tweetTextarea_1")
    ) {
      return state.threadTextareaCount > 1 ? 2 : state.threadTextareaCount > 0 ? 1 : 0;
    }
  }
  const match = selector.match(/tweetTextarea_(\d+)/);
  if (match) {
    const index = Number(match[1]);
    return state.threadTextareaCount > index ? 1 : 0;
  }
  if (selector.includes("signals-publish-target")) {
    return state.composeOpen ? 1 : 0;
  }
  if (selector.includes("tweetTextarea_")) {
    return state.threadTextareaCount;
  }
  if (selector.includes("contenteditable") || selector.includes("role=\"textbox\"")) {
    return state.composeOpen ? 1 : 0;
  }
  if (selector.includes("addButton") || selector.includes("Add post")) {
    if (process.env.FAKE_AB_HIDE_GLOBAL_ADD === "1") {
      const dialogScoped =
        selector.includes("role=\"dialog\"") || selector.includes('[role="dialog"]');
      if (!dialogScoped) {
        return 0;
      }
    }
    if (process.env.FAKE_AB_GLOBAL_ADD_ONLY === "1") {
      const dialogScoped =
        selector.includes("role=\"dialog\"") || selector.includes('[role="dialog"]');
      if (dialogScoped) {
        return 0;
      }
    }
    if (process.env.FAKE_AB_DIALOG_ADD_ONLY === "1") {
      const dialogScoped =
        selector.includes("role=\"dialog\"") || selector.includes('[role="dialog"]');
      if (!dialogScoped) {
        return 0;
      }
    }
    return state.composeOpen && state.mainTweetTyped ? 1 : 0;
  }
  if (selector.includes("tweetButton")) return 1;
  if (selector.includes("fileInput")) return 1;
  if (selector.includes("attachments")) return 1;
  return 0;
}

function handleGet(rest, state) {
  const sub = rest[1];
  if (sub === "url") {
    return ok(state.composeOpen ? "https://x.com/compose/post" : "https://x.com/home");
  }
  if (sub === "count") {
    const selector = rest[2] ?? "";
    return ok(String(textareaCountForSelector(selector, state)));
  }
  if (sub === "attr") {
    const selector = rest[2];
    const name = rest[3];
    if (name !== "href") fail(`unexpected attr name: ${name}`);
    if (
      selector.includes("AppTabBar_Profile_Link") ||
      selector.includes("aria-label=\"Profile\"")
    ) {
      return ok(`/${profileHandle}`);
    }
    fail(`unexpected attr selector: ${selector}`);
  }
  fail(`unexpected get: ${rest.join(" ")}`);
}

function handleIs(rest) {
  if (rest[1] === "visible" && rest[2]?.includes("loginButton")) return ok("false");
  return ok("true");
}

function recordTypedText(state, selector, text) {
  const sel = String(selector);
  const mark = sel.match(/signals-publish-thread-(\d+)/);
  const num = sel.match(/tweetTextarea_(\d+)/);
  const index = mark ? Number(mark[1]) : num ? Number(num[1]) : 0;
  if (!state.composedTextByIndex) state.composedTextByIndex = {};
  state.composedTextByIndex[index] = text;
  if (index === 0) {
    state.mainTweetTyped = Boolean(String(text).trim());
    state.mainTweetText = text;
  }
  writeState(state);
}

function rememberSelector(state, selector) {
  state.lastSelector = selector;
  writeState(state);
}

function focusableAddButtonFromEvalJs(js, state) {
  if (!state.composeOpen || !state.mainTweetTyped) return false;
  const match = js.match(/const queries = (\[[\s\S]*?\]);/);
  if (!match) return false;
  try {
    const queries = JSON.parse(match[1]);
    for (const q of queries) {
      if (textareaCountForSelector(q, state) > 0) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function handleEval(rest, state) {
  const js = rest[1] ?? "";
  if (js.includes("ownedCandidates")) {
    if (state.postPublished) {
      const ms = Date.now() - 1288834974657;
      const statusId = (BigInt(ms) << 22n).toString();
      const payload = [
        {
          statusId,
          href: `/${profileHandle}/status/${statusId}`,
          text: "thread tweet one thread tweet two",
        },
      ];
      return ok(JSON.stringify(JSON.stringify(payload)));
    }
    return ok(JSON.stringify("[]"));
  }
  if (js.includes("addButton") && js.includes("activeElement")) {
    if (!focusableAddButtonFromEvalJs(js, state)) {
      return ok(JSON.stringify(JSON.stringify({ ok: false, reason: "no_add_button" })));
    }
    return ok(JSON.stringify(JSON.stringify({ ok: true })));
  }
  if (js.includes("queries") && js.includes("btn.focus") && js.includes("addButton")) {
    if (!focusableAddButtonFromEvalJs(js, state)) {
      return ok(JSON.stringify(JSON.stringify({ ok: false, reason: "no_add_button" })));
    }
    return ok(JSON.stringify(JSON.stringify({ ok: true })));
  }
  if (
    js.includes("KeyboardEvent") &&
    js.includes("addButton") &&
    js.includes("keydown")
  ) {
    if (!focusableAddButtonFromEvalJs(js, state)) {
      return ok(JSON.stringify(JSON.stringify({ ok: false, reason: "no_add_button" })));
    }
    addThreadSlot(state);
    return ok(JSON.stringify(JSON.stringify({ ok: true, via: "keyboard_eval" })));
  }
  if (js.includes("contenteditable") && js.includes("activeElement")) {
    return ok(JSON.stringify(JSON.stringify({ ok: true })));
  }
  if (js.includes("nextElementSibling") && js.includes("addButton")) {
    addThreadSlot(state);
    return ok(JSON.stringify(JSON.stringify({ ok: true, via: "sibling" })));
  }
  if (
    js.includes("parentElement") &&
    (js.includes("addButton") || js.includes("Add post")) &&
    !js.includes("innerText") &&
    !js.includes("textContent")
  ) {
    if (!state.composeOpen || !state.mainTweetTyped) {
      return ok(
        JSON.stringify(JSON.stringify({ ok: false, reason: "no_button_near_anchor" }))
      );
    }
    if (js.includes("btn.click()")) {
      addThreadSlot(state);
      return ok(JSON.stringify(JSON.stringify({ ok: true, via: "ancestor", depth: 1 })));
    }
    return ok(JSON.stringify(JSON.stringify({ ok: true, depth: 1 })));
  }
  if (
    js.includes("data-testid^=\"tweetTextarea_\"") &&
    js.includes("slots.push")
  ) {
    const slots = [];
    if (process.env.FAKE_AB_DUPLICATE_TEXTAREA_0 === "1" && state.threadTextareaCount > 1) {
      slots.push({
        testId: "tweetTextarea_0",
        index: 0,
        text: state.composedTextByIndex?.[1] ?? "",
      });
      slots.push({
        testId: "tweetTextarea_0",
        index: 0,
        text: `${state.composedTextByIndex?.[0] ?? ""} ${state.composedTextByIndex?.[1] ?? ""}`.trim(),
      });
    } else {
      for (let i = 0; i < state.threadTextareaCount; i++) {
        const text = state.composedTextByIndex?.[i] ?? (i === 0 ? state.mainTweetText : "");
        slots.push({
          testId: `tweetTextarea_${i}`,
          index: i,
          text,
        });
      }
    }
    return ok(JSON.stringify(JSON.stringify({ ok: true, slots })));
  }
  if (
    js.includes("signals-publish-thread") &&
    !js.includes("innerText") &&
    !js.includes("textContent")
  ) {
    const match = js.match(/signals-publish-thread-(\d+)/);
    const index = match ? Number(match[1]) : 0;
    const mark = `signals-publish-thread-${index}`;
    return ok(
      JSON.stringify(
        JSON.stringify({
          ok: true,
          selector: `[data-signals-publish-target="${mark}"]`,
        })
      )
    );
  }
  if (
    js.includes("querySelectorAll") &&
    js.includes("tweetTextarea_0") &&
    js.includes("zeros.length")
  ) {
    const indexMatch = js.match(/zeros\.length <= (\d+)/);
    const needIndex = indexMatch ? Number(indexMatch[1]) : 0;
    if (state.threadTextareaCount > needIndex) {
      const mark = `signals-publish-thread-${needIndex}`;
      return ok(
        JSON.stringify(
          JSON.stringify({
            ok: true,
            selector: `[data-signals-publish-target="${mark}"]`,
          })
        )
      );
    }
    return ok(JSON.stringify(JSON.stringify({ ok: false })));
  }
  if ((js.includes("innerText") || js.includes("textContent"))) {
    const zerosMatch = js.match(/zeros\[(\d+)\]/);
    if (zerosMatch) {
      const index = Number(zerosMatch[1]);
      const text = state.composedTextByIndex?.[index] ?? "";
      return ok(JSON.stringify(JSON.stringify(text)));
    }
    const markMatch = js.match(/signals-publish-thread-(\d+)/);
    if (markMatch) {
      const index = Number(markMatch[1]);
      const text = state.composedTextByIndex?.[index] ?? "";
      return ok(JSON.stringify(JSON.stringify(text)));
    }
    const match = js.match(/tweetTextarea_(\d+)/);
    const index = match ? Number(match[1]) : 0;
    const text =
      state.composedTextByIndex?.[index] ?? (index === 0 ? state.mainTweetText : "") ?? "";
    return ok(JSON.stringify(JSON.stringify(text)));
  }
  if (js.includes("execCommand") && js.includes("insertText")) {
    const marker = "const payload = ";
    const idx = js.indexOf(marker);
    if (idx >= 0) {
      try {
        const slice = js.slice(idx + marker.length);
        const end = slice.indexOf(";");
        const text = JSON.parse(slice.slice(0, end).trim());
        const index = state.activeTextareaIndex ?? 0;
        recordTypedText(
          state,
          state.lastSelector || `tweetTextarea_${index}`,
          text
        );
        const normalized = String(text).replace(/\s+/g, " ").trim();
        return ok(JSON.stringify(JSON.stringify({ ok: true, text: normalized })));
      } catch {
        return ok(JSON.stringify(JSON.stringify({ ok: false, text: "" })));
      }
    }
  }
  return ok("null");
}

function openCompose(state, mode = "page") {
  state.composeOpen = true;
  state.composeUiMode = mode;
  state.threadTextareaCount = 1;
  writeState(state);
}

function addThreadSlot(state) {
  if (!state.composeOpen) openCompose(state);
  state.threadTextareaCount += 1;
  writeState(state);
}

const state = readState();
const rest = parseArgv(process.argv);
const cmd = rest[0];

if (!cmd) fail("missing command");

if (cmd === "connect") return ok();
if (cmd === "tab") {
  if (rest[1] === "list") {
    if (rest.includes("--json")) return tabListJson(state);
    return ok("t1 - devtools\n t2 - https://x.com/home");
  }
  if (/^t\d+$/.test(rest[1] ?? "")) {
    state.activeTab = rest[1];
    writeState(state);
    return ok();
  }
  return ok();
}

if (cmd === "get") return handleGet(rest, state);
if (cmd === "is") return handleIs(rest);
if (cmd === "open") {
  const url = rest[1] ?? "";
  if (url.includes("compose/post")) openCompose(state, "page");
  return ok();
}
if (cmd === "wait") return ok();
if (cmd === "focus") {
  const sel = rest[1] ?? "";
  rememberSelector(state, sel);
  const markerMatch = sel.match(/signals-publish-thread-(\d+)/);
  if (markerMatch) state.activeTextareaIndex = Number(markerMatch[1]);
  const textareaMatch = sel.match(/tweetTextarea_(\d+)/);
  if (textareaMatch) state.activeTextareaIndex = Number(textareaMatch[1]);
  writeState(state);
  return ok();
}
if (cmd === "clipboard") {
  if (rest[1] === "write") {
    const text = rest[2] ?? "";
    recordTypedText(
      state,
      state.lastSelector || `tweetTextarea_${state.activeTextareaIndex ?? 0}`,
      text
    );
  }
  return ok();
}
if (cmd === "click") {
  const selector = rest[1] ?? "";
  rememberSelector(state, selector);
  if (
    process.env.FAKE_AB_FAIL_ADD === "1" &&
    (selector.includes("addButton") || selector.includes("Add post"))
  ) {
    fail("simulated add button failure");
  }
  if (selector.includes("addButton") || selector.includes("Add post")) {
    if (process.env.FAKE_AB_RESET_ON_ADD_CLICK === "1") {
      state.composedTextByIndex[0] = "\n";
      state.mainTweetText = "\n";
      state.mainTweetTyped = false;
      writeState(state);
    }
  }
  const textareaMatch = selector.match(/tweetTextarea_(\d+)/);
  if (textareaMatch) {
    state.activeTextareaIndex = Number(textareaMatch[1]);
    writeState(state);
  }
  const markerMatch = selector.match(/signals-publish-thread-(\d+)/);
  if (markerMatch) {
    state.activeTextareaIndex = Number(markerMatch[1]);
    writeState(state);
  }
  if (selector.includes("tweetButton")) {
    state.postPublished = true;
    writeState(state);
  }
  return ok();
}
if (cmd === "type" || cmd === "fill") {
  const selector = rest[1] ?? "";
  rememberSelector(state, selector);
  const text = rest[2] ?? "";
  if (process.env.FAKE_AB_FAIL_THREAD_FILL === "1" && selector.includes("tweetTextarea_1")) {
    fail("simulated thread fill failure");
  }
  if (selector.includes("tweetTextarea_0")) {
    openCompose(state, state.composeUiMode || "page");
  }
  recordTypedText(state, selector, text);
  return ok();
}
if (cmd === "keyboard") {
  const sub = rest[1] ?? "";
  const text = rest.slice(2).join(" ");
  if (sub === "type" || sub === "inserttext") {
    if (process.env.FAKE_AB_SKIP_KEYBOARD !== "1") {
      recordTypedText(
        state,
        state.lastSelector || `tweetTextarea_${state.activeTextareaIndex ?? 0}`,
        text
      );
    }
  }
  return ok();
}
if (cmd === "press") {
  const key = rest[1] ?? "";
  if (
    key === "Enter" &&
    state.composeOpen &&
    state.mainTweetTyped &&
    focusableAddButtonFromEvalJs(
      `const queries = ${JSON.stringify([
        '[role="dialog"] [data-testid="addButton"]',
        '[role="dialog"] button[aria-label="Add post"]',
        '[role="dialog"] button[aria-label="添加帖子"]',
        '[role="dialog"] [aria-label="Add post"]',
        '[data-testid="addButton"]',
        'button[aria-label="Add post"]',
        'button[aria-label="添加帖子"]',
        '[aria-label="Add post"]',
      ])};`,
      state
    )
  ) {
    addThreadSlot(state);
  }
  return ok();
}
if (cmd === "upload") return ok();
if (cmd === "eval") return handleEval(rest, state);

fail(`unsupported fake command: ${rest.join(" ")}`);
