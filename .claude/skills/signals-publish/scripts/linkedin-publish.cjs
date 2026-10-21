#!/usr/bin/env node
/**
 * Deterministic LinkedIn publish via host agent-browser CLI (external skill dependency).
 *
 * Usage:
 *   node scripts/linkedin-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]
 */
"use strict";

const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { verifyPublishJob } = require("./publish-job-guard.cjs");
const { parseEvalJsonValue } = require("./parse-eval-json-array.cjs");

const SESSION = process.env.SIGNALS_PUBLISH_AB_SESSION || "signals-publish";
const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const AB_PREFIX = process.env.AGENT_BROWSER_BIN_ARGS
  ? process.env.AGENT_BROWSER_BIN_ARGS.split(" ").filter(Boolean)
  : [];
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const LINKEDIN_SELF_PROFILE_URL = "https://www.linkedin.com/in/me/";
const WAIT_TIMEOUT_MS = 15_000;

let resultEmitted = false;

function logPhase(message) {
  process.stderr.write(`linkedin-publish: ${message}\n`);
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
        "Usage: node linkedin-publish.cjs --port <cdpPort> --payload <job.json> [--dry-run]",
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

const LI_SELECTORS = {
  composerTrigger:
    "button.share-box-feed-entry__trigger, button:has-text('Start a post'), .share-box-feed-entry__top-bar button",
  composerDialog: "[role=\"dialog\"], .share-box",
  tiptapEditor:
    ".tiptap.ProseMirror, .editor-content .ProseMirror, [contenteditable=\"true\"].ProseMirror, .ql-editor",
  mediaButton:
    "button[aria-label*=\"media\" i], button[aria-label*=\"photo\" i], button[aria-label*=\"video\" i], button.share-promoted-detour-button",
  fileInput: "input[type=\"file\"]",
  mediaNextButton:
    "button[aria-label=\"Next\"], button:has-text('Next'), button.share-box-footer__primary-btn",
  postButton:
    "button.share-actions__primary-action, [role=\"dialog\"] button:has-text('Post')",
};

function openLinkedInFeed() {
  requireAb(["open", LINKEDIN_FEED_URL], "open linkedin feed");
  sleep(2000);
}

/** "/in/Name", "in/name/", "@name", or a profile URL → "name", as Signals normalizes targets. */
function linkedInVanity(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^@/, "")
    .replace(/^\/?in\//i, "")
    .replace(/^\/+/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

/**
 * The signed-in profile's vanity. `/in/me/` redirects only an authenticated session to its own
 * profile; the feed's navigation may carry no profile link, and a profile link in feed content
 * can be anyone's. A login, checkpoint or authwall page means the session is signed out.
 */
function detectLinkedInHandle() {
  requireAb(["open", LINKEDIN_SELF_PROFILE_URL], "open linkedin self profile");
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const url = String(runAb(["get", "url"]).stdout || "");
    const path = url.replace(/^https?:\/\/[^/]+/i, "").toLowerCase();
    if (/^\/(login|signup|checkpoint|authwall|uas\/login)/.test(path)) {
      throw { message: "LinkedIn session is logged out.", errorCode: "session_expired" };
    }
    const vanity = linkedInVanity(path.startsWith("/in/") ? path : "");
    if (vanity && vanity !== "me") return vanity;
    if (Date.now() >= deadline) {
      throw {
        message: `Could not resolve the signed-in LinkedIn profile from ${LINKEDIN_SELF_PROFILE_URL} (at ${url || "unknown URL"}).`,
        errorCode: "session_expired",
      };
    }
    sleep(300);
  }
}

function openComposer() {
  if (abCount(LI_SELECTORS.tiptapEditor) === 0) {
    waitForSelector(LI_SELECTORS.composerTrigger, "wait for composer trigger");
    requireAb(["click", LI_SELECTORS.composerTrigger], "open linkedin composer");
    sleep(1500);
  }
  waitForSelector(LI_SELECTORS.tiptapEditor, "wait for tiptap editor");
}

function uploadMedia(mediaPaths) {
  if (!mediaPaths?.length) return;
  if (abCount(LI_SELECTORS.mediaButton) > 0) {
    requireAb(["click", LI_SELECTORS.mediaButton], "click media button");
    sleep(1000);
  }
  waitForSelector(LI_SELECTORS.fileInput, "wait for linkedin file input");
  for (const mediaPath of mediaPaths) {
    requireAb(["upload", LI_SELECTORS.fileInput, mediaPath], `upload ${mediaPath}`);
    sleep(2000);
  }

  // If a Next button appears (photo crop/edit modal), click it
  if (abCount(LI_SELECTORS.mediaNextButton) > 0) {
    requireAb(["click", LI_SELECTORS.mediaNextButton], "click media next button");
    sleep(1500);
  }

  // Re-ensure main compose dialog is ready
  waitForSelector(LI_SELECTORS.tiptapEditor, "wait for tiptap editor after media attachment");
}

function injectTipTapText(text) {
  // Focus the TipTap / ProseMirror editor
  requireAb(["click", LI_SELECTORS.tiptapEditor], "focus tiptap editor");
  sleep(300);

  // Use native CDP keyboard input (Input.insertText)
  // This triggers browser-level trusted beforeinput events that TipTap/ProseMirror
  // intercepts to dispatch ProseMirror transactions, keeping React state in sync.
  requireAb(["keyboard", "inserttext", text], "insert text into tiptap editor");
  sleep(500);
}

function assertPreFlight(expectedText) {
  const checkJs = `(() => {
    const ed = document.querySelector('${LI_SELECTORS.tiptapEditor}');
    const postBtn = document.querySelector('${LI_SELECTORS.postButton}');
    const text = ed ? (ed.innerText || ed.textContent || '') : '';
    const ariaDisabled = postBtn ? postBtn.getAttribute('aria-disabled') : null;
    const disabled = postBtn ? postBtn.disabled : false;
    return JSON.stringify({
      hasText: text.trim().length > 0,
      textSnippet: text.slice(0, 100),
      isPostEnabled: ariaDisabled !== 'true' && !disabled
    });
  })()`;
  const raw = requireAb(["eval", checkJs], "run pre-flight check").stdout;
  const parsed = parseEvalJsonValue(raw);
  if (!parsed || typeof parsed !== "object") {
    throw {
      message: `Failed to parse pre-flight status: ${raw}`,
      errorCode: "unknown",
    };
  }

  if (!parsed.hasText) {
    throw {
      message: "TipTap editor state synchronization failed: editor text is empty after insertion.",
      errorCode: "tiptap_desync",
    };
  }

  if (!parsed.isPostEnabled) {
    throw {
      message: "LinkedIn Post button remains disabled after text insertion.",
      errorCode: "post_button_disabled",
    };
  }
}

function verifyPublishedPost() {
  const verifyJs = `(() => {
    const toastLink =
      document.querySelector('a.artdeco-toast-item__action') ||
      Array.from(document.querySelectorAll('a')).find(a => a.textContent && a.textContent.includes('View post'));
    if (toastLink && toastLink.href) {
      return JSON.stringify({ url: toastLink.href });
    }
    const recentLink = document.querySelector('.feed-shared-update-v2 a[href*="/feed/update/"]');
    if (recentLink && recentLink.href) {
      return JSON.stringify({ url: recentLink.href });
    }
    return JSON.stringify({ url: '' });
  })()`;
  const raw = runAb(["eval", verifyJs]).stdout;
  return parseEvalJsonValue(raw)?.url || null;
}

async function main() {
  const { port, payload, dryRun } = parseArgs(process.argv);
  ensureAgentBrowser();

  try {
    validatePayload(payload);
    logPhase(`start dryRun=${dryRun}`);
    if (!dryRun) {
      await verifyPublishJob({
        payload,
        platform: "linkedin",
        baseUrl: process.env.SIGNALS_BASE_URL,
      });
    }
    connectSession(port);

    const detectedHandle = detectLinkedInHandle();
    const expectedHandle = payload.expectedHandle;
    if (expectedHandle && linkedInVanity(expectedHandle) !== detectedHandle) {
      emit({
        success: false,
        error: `Wrong LinkedIn identity active: expected ${expectedHandle}, detected ${detectedHandle || "(unknown)"}`,
        errorCode: "wrong_account",
        expectedHandle,
        detectedHandle,
      });
      return;
    }
    const handle = expectedHandle ?? detectedHandle;

    openLinkedInFeed();
    openComposer();

    // 1. Upload media first so compose view is stable
    const mediaPaths = Array.isArray(payload.mediaPaths) ? payload.mediaPaths : [];
    uploadMedia(mediaPaths);

    // 2. Inject text natively into TipTap / ProseMirror
    injectTipTapText(payload.text);

    // 3. Pre-flight assertion
    assertPreFlight(payload.text);

    if (dryRun) {
      emit({
        success: true,
        dryRun: true,
        handle,
        message: "LinkedIn compose filled and verified; Post was not clicked (dry-run).",
      });
      return;
    }

    waitForSelector(LI_SELECTORS.postButton, "wait for linkedin post button");
    requireAb(["click", LI_SELECTORS.postButton], "click linkedin post button");
    sleep(4000);

    const verifiedUrl = verifyPublishedPost();
    if (verifiedUrl) {
      const match = verifiedUrl.match(/activity[:-](\d+)/);
      const platformPostId = match ? match[1] : undefined;
      emit({
        success: true,
        handle,
        platformPostId,
        platformUrl: verifiedUrl,
      });
    } else {
      emit({
        success: false,
        postSubmitted: true,
        handle,
        error:
          "LinkedIn Post was clicked, but the new post permalink has not been verified. Inspect the feed or profile before calling complete_publish; do not click Post again.",
        errorCode: "verify_uncertain",
      });
    }
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
