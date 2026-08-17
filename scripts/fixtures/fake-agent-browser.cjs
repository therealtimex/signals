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
  }
  if (!state.composeOpen) {
    if (selector.includes("tweetTextarea_0") && !selector.includes("tweetTextarea_1")) {
      return 0;
    }
    return 0;
  }
  const match = selector.match(/tweetTextarea_(\d+)/);
  if (match) {
    const index = Number(match[1]);
    return state.threadTextareaCount > index ? 1 : 0;
  }
  if (selector.includes("tweetTextarea_")) {
    return state.threadTextareaCount;
  }
  if (selector.includes("addButton") || selector.includes("Add post")) {
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

function handleEval(rest, state) {
  const js = rest[1] ?? "";
  if (js.includes("addButton") && js.includes("activeElement")) {
    const addCount = state.composeOpen && state.mainTweetTyped ? 1 : 0;
    if (!state.composeOpen || addCount === 0) {
      return ok(JSON.stringify(JSON.stringify({ ok: false, reason: "no_add_button" })));
    }
    return ok(JSON.stringify(JSON.stringify({ ok: true })));
  }
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
  if (js.includes("ownedCandidates")) return ok(JSON.stringify("[]"));
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
if (cmd === "click") {
  const selector = rest[1] ?? "";
  if (
    process.env.FAKE_AB_FAIL_ADD === "1" &&
    (selector.includes("addButton") || selector.includes("Add post"))
  ) {
    fail("simulated add button failure");
  }
  if (selector.includes("addButton") || selector.includes("Add post")) {
    addThreadSlot(state);
  }
  if (selector.includes("tweetButton")) {
    state.postPublished = true;
    writeState(state);
  }
  return ok();
}
if (cmd === "type" || cmd === "fill") {
  const selector = rest[1] ?? "";
  if (process.env.FAKE_AB_FAIL_THREAD_FILL === "1" && selector.includes("tweetTextarea_1")) {
    fail("simulated thread fill failure");
  }
  if (selector.includes("tweetTextarea_0")) {
    openCompose(state, state.composeUiMode || "page");
    state.mainTweetTyped = true;
    writeState(state);
  }
  return ok();
}
if (cmd === "keyboard") {
  if (rest[1] === "type") {
    state.mainTweetTyped = true;
    writeState(state);
  }
  return ok();
}
if (cmd === "press") {
  if (state.composeOpen) addThreadSlot(state);
  return ok();
}
if (cmd === "upload") return ok();
if (cmd === "eval") return handleEval(rest, state);

fail(`unsupported fake command: ${rest.join(" ")}`);
