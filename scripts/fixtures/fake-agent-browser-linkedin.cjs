#!/usr/bin/env node
/**
 * Stateful fake agent-browser CLI for linkedin-publish tests. State persists in FAKE_AB_STATE_FILE.
 *
 * Output follows agent-browser 0.34.0: `eval` prints the page's return value JSON-encoded, so a
 * string result arrives quoted; `get url` and `get count` print bare values.
 *
 * The feed models LinkedIn's UI as seen on 2026-10-20: no `.global-nav__me` and no profile link
 * in the navigation. `/in/me/` redirects to `/in/<FAKE_LI_SELF>/?isSelfProfile=true`, or to the
 * login page when FAKE_LI_SELF is empty. FAKE_LI_FIRST_PROFILE_LINK is the first `/in/` link in
 * the feed's content. FAKE_LI_FEED_MARKERS=1 also renders the older `.scaffold-layout` marker.
 */
"use strict";

const fs = require("node:fs");

const stateFile = process.env.FAKE_AB_STATE_FILE;
if (!stateFile) {
  console.error("FAKE_AB_STATE_FILE is required");
  process.exit(1);
}
const self = process.env.FAKE_LI_SELF ?? "session-owner";
const firstProfileLink = process.env.FAKE_LI_FIRST_PROFILE_LINK ?? "someone-in-the-feed";

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { currentUrl: "", composerOpen: false, text: "", posted: false, commands: [] };
  }
}

const state = readState();

function done(output = "", code = 0) {
  fs.writeFileSync(stateFile, JSON.stringify(state));
  if (output !== "") (code === 0 ? process.stdout : process.stderr).write(`${output}\n`);
  process.exit(code);
}

/** agent-browser prints an eval result as JSON, so a string the page returns arrives quoted. */
function evalResult(value) {
  done(JSON.stringify(value));
}

const args = process.argv.slice(2);
if (args[0] === "--version") done("fake-agent-browser-linkedin 0.34.0");
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session") i += 1;
  else rest.push(args[i]);
}
const [cmd, sub, ...more] = rest;
state.commands.push(rest.join(" ").slice(0, 120));

const onFeed = () => /linkedin\.com\/feed/.test(state.currentUrl);

function count(selector) {
  if (selector.includes("ProseMirror")) return state.composerOpen ? 1 : 0;
  if (selector.includes("share-box-feed-entry__trigger")) return onFeed() ? 1 : 0;
  if (selector.includes("share-actions__primary-action")) return state.composerOpen ? 1 : 0;
  if (selector.includes('input[type="file"]')) return state.composerOpen ? 1 : 0;
  if (selector.includes("scaffold-layout")) {
    return onFeed() && process.env.FAKE_LI_FEED_MARKERS === "1" ? 1 : 0;
  }
  return 0;
}

switch (cmd) {
  case "connect":
  case "wait":
  case "upload":
    done();
    break;
  case "open":
    state.currentUrl =
      sub === "https://www.linkedin.com/in/me/"
        ? self
          ? `https://www.linkedin.com/in/${self}/?isSelfProfile=true`
          : "https://www.linkedin.com/login?session_redirect=%2Fin%2Fme%2F"
        : sub;
    done();
    break;
  case "get":
    if (sub === "url") done(state.currentUrl);
    if (sub === "count") done(String(count(more[0] ?? "")));
    done(`unexpected get: ${rest.join(" ")}`, 1);
    break;
  case "click": {
    if (sub.includes("share-box-feed-entry__trigger")) state.composerOpen = onFeed();
    else if (sub.includes("share-actions__primary-action")) state.posted = state.composerOpen;
    done();
    break;
  }
  case "keyboard":
    if (sub === "inserttext") state.text = more.join(" ");
    done();
    break;
  case "eval": {
    const js = sub ?? "";
    if (js.includes("isPostEnabled")) {
      const hasText = state.text.trim().length > 0;
      evalResult(
        JSON.stringify({ hasText, textSnippet: state.text.slice(0, 100), isPostEnabled: hasText })
      );
    }
    if (js.includes("artdeco-toast-item__action")) {
      evalResult(
        JSON.stringify({
          url: state.posted ? "https://www.linkedin.com/feed/update/urn:li:activity:7123456789/" : "",
        })
      );
    }
    if (js.includes("a[href*=\"/in/\"]")) evalResult(JSON.stringify(firstProfileLink));
    evalResult(null);
    break;
  }
  default:
    done(`unsupported fake command: ${rest.join(" ")}`, 1);
}
