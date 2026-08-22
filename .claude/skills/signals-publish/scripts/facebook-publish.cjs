#!/usr/bin/env node
/**
 * Deterministic Facebook publish via host agent-browser CLI (external skill dependency).
 *
 * Usage:
 *   node scripts/facebook-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]
 */
"use strict";

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const AB_PREFIX = process.env.AGENT_BROWSER_BIN_ARGS
  ? process.env.AGENT_BROWSER_BIN_ARGS.split(" ").filter(Boolean)
  : [];
const FB_HOME_URL = "https://www.facebook.com/";
const WAIT_TIMEOUT_MS = 15_000;

let resultEmitted = false;

function logPhase(message) {
  process.stderr.write(`facebook-publish: ${message}\n`);
}

function emit(result) {
  resultEmitted = true;
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.success ? 0 : 1);
}

function emitFatal(message, errorCode = "unknown") {
  emit({ success: false, error: message, errorCode });
}

function sleep(ms) {
  requireAb(["wait", String(ms)], "wait");
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

function waitForSelector(selector, context, timeoutMs = WAIT_TIMEOUT_MS) {
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
      error:
        "Usage: node facebook-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]",
      errorCode: "unknown",
    });
  }
  return {
    port,
    payload: JSON.parse(readFileSync(payloadPath, "utf8")),
    dryRun,
  };
}

function connectSession(port) {
  requireAb(["connect", String(port)], "connect CDP session");
}

function validatePayload(payload) {
  if (!String(payload?.text ?? "").trim()) {
    throw {
      message: "payload.text is required and must be non-empty",
      errorCode: "unknown",
    };
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
}

const FB_SELECTORS = {
  homeFeed: '[role="feed"]',
  composerTrigger:
    '[role="button"][tabindex="0"][aria-label*="on your mind" i], [role="button"][tabindex="0"][aria-label*="Bạn đang nghĩ gì" i]',
  composerDialog: '[role="dialog"]',
  composerTextbox:
    '[role="dialog"] [role="textbox"][contenteditable="true"], [role="dialog"] div[contenteditable="true"]',
  postButton:
    '[role="dialog"] [aria-label="Post"], [role="dialog"] [aria-label="Đăng"]',
  fileInput: '[role="dialog"] input[type="file"]',
};

function openFacebookHome() {
  requireAb(["open", FB_HOME_URL], "open facebook home");
  sleep(2000);
}

function assertFacebookLoggedIn() {
  if (abCount(FB_SELECTORS.homeFeed) > 0) return;
  const urlResult = runAb(["get", "url"]);
  const url = String(urlResult.stdout || "").toLowerCase();
  if (url.includes("/login")) {
    throw { message: "Facebook session is logged out.", errorCode: "session_expired" };
  }
  throw { message: "Could not verify Facebook login state.", errorCode: "session_expired" };
}

function detectFacebookHandle() {
  const js = `(() => {
    const link =
      document.querySelector('a[aria-label*="profile" i][href*="facebook.com"]') ||
      document.querySelector('div[role="navigation"] a[href*="facebook.com/me"]');
    if (!link) return JSON.stringify("");
    const href = link.getAttribute("href") || "";
    const slugMatch = href.match(/facebook\\.com\\/([^/?#]+)/i);
    if (slugMatch && !["home", "login", "watch", "marketplace"].includes(slugMatch[1])) {
      return JSON.stringify(slugMatch[1]);
    }
    const idMatch = href.match(/profile\\.php\\?id=(\\d+)/i);
    return JSON.stringify(idMatch ? "id:" + idMatch[1] : "");
  })()`;
  const raw = requireAb(["eval", js], "detect facebook handle").stdout;
  try {
    return JSON.parse(raw);
  } catch {
    return "";
  }
}

function openComposer() {
  if (abCount(FB_SELECTORS.composerTextbox) === 0) {
    waitForSelector(FB_SELECTORS.composerTrigger, "wait for composer trigger");
    requireAb(["click", FB_SELECTORS.composerTrigger], "open facebook composer");
    sleep(1000);
  }
  waitForSelector(FB_SELECTORS.composerTextbox, "wait for composer textbox");
}

function typeComposerText(text) {
  requireAb(["click", FB_SELECTORS.composerTextbox], "focus composer");
  requireAb(["keyboard", "type", text], "type facebook post");
  sleep(500);
}

function uploadMedia(mediaPaths) {
  if (!mediaPaths?.length) return;
  waitForSelector(FB_SELECTORS.fileInput, "wait for facebook file input");
  for (const mediaPath of mediaPaths) {
    requireAb(["upload", FB_SELECTORS.fileInput, mediaPath], `upload ${mediaPath}`);
    sleep(1000);
  }
}

function main() {
  const { port, payload, dryRun } = parseArgs(process.argv);
  ensureAgentBrowser();

  try {
    validatePayload(payload);
    logPhase(`start dryRun=${dryRun}`);
    connectSession(port);
    openFacebookHome();
    assertFacebookLoggedIn();

    const detectedHandle = detectFacebookHandle();
    const expectedHandle = payload.expectedHandle;
    if (
      expectedHandle &&
      String(expectedHandle).replace(/^@/, "").toLowerCase() !==
        String(detectedHandle).replace(/^@/, "").toLowerCase()
    ) {
      emit({
        success: false,
        error: `Wrong Facebook identity active: expected ${expectedHandle}, detected ${detectedHandle || "(unknown)"}`,
        errorCode: "wrong_account",
        expectedHandle,
        detectedHandle,
      });
      return;
    }
    const handle = expectedHandle ?? detectedHandle ?? "facebook";

    openComposer();
    typeComposerText(payload.text);
    const mediaPaths = Array.isArray(payload.mediaPaths) ? payload.mediaPaths : [];
    uploadMedia(mediaPaths);

    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        handle,
        message: "Facebook compose filled; Post was not clicked (dry-run).",
      });
      return;
    }

    waitForSelector(FB_SELECTORS.postButton, "wait for facebook post button");
    requireAb(["click", FB_SELECTORS.postButton], "click facebook post button");
    sleep(3000);

    emit({
      success: true,
      handle,
      platformPostId: `fb_${Date.now()}`,
      platformUrl: FB_HOME_URL,
    });
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
