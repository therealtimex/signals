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

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { activeTab: "t1", postPublished: false };
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
  return {
    active: state.activeTab === "t2",
    label: null,
    tabId: "t2",
    title: "Home / X",
    type: "page",
    url: "https://x.com/home",
  };
}

function tabListJson(state) {
  jsonOut({
    success: true,
    data: { tabs: [shellTab(state), contentTab(state)] },
    error: null,
  });
}

function handleGet(rest) {
  const sub = rest[1];
  if (sub === "url") return ok("https://x.com/home");
  if (sub === "count") return ok("1");
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
  if (state.postPublished) {
    const ms = Date.now() - 1288834974657;
    const statusId = (BigInt(ms) << 22n).toString();
    return ok(
      JSON.stringify([
        {
          statusId,
          href: `/${profileHandle}/status/${statusId}`,
          text: "thread tweet one thread tweet two",
        },
      ])
    );
  }
  if (js.includes("ownedCandidates")) return ok("[]");
  return ok("null");
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

if (cmd === "get") return handleGet(rest);
if (cmd === "is") return handleIs(rest);
if (cmd === "open") return ok();
if (cmd === "wait") return ok();
if (cmd === "click") {
  if (process.env.FAKE_AB_FAIL_ADD === "1" && rest[1]?.includes("addButton")) {
    fail("simulated add button failure");
  }
  if (rest[1]?.includes("tweetButton")) {
    state.postPublished = true;
    writeState(state);
  }
  return ok();
}
if (cmd === "fill") {
  if (process.env.FAKE_AB_FAIL_THREAD_FILL === "1" && rest[1]?.includes("tweetTextarea_1")) {
    fail("simulated thread fill failure");
  }
  return ok();
}
if (cmd === "upload") return ok();
if (cmd === "eval") return handleEval(rest, state);

fail(`unsupported fake command: ${rest.join(" ")}`);
