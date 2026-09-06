#!/usr/bin/env node
/**
 * Render a Signals page in the running app and report what is actually on it.
 *
 * Written after three defects in one workflow template that every test passed: the template seeded
 * correctly, its config was right, its dispatch was right — and the dialog still showed the wrong
 * fields, because nothing had opened it. Unit tests assert on the data a component is given, not on
 * what it renders; jsdom does not resolve layout or hit-testing either. This talks to the real
 * browser the app is running in.
 *
 *   npm run probe:ui -- --path /dashboard/organizations --eval "document.querySelectorAll('tbody tr').length"
 *   npm run probe:ui -- --path /dashboard/workflows --click "Deduplicate & Merge Companies" --dialog
 *
 * Flags:
 *   --path <p>     page to inspect, relative to the Signals base URL (default /dashboard)
 *   --eval <expr>  JavaScript evaluated in the page; its value is printed as JSON
 *   --click <text> click the nearest button to an element with this exact text, before evaluating
 *   --dialog       shorthand for reporting the open dialog's title and field labels
 *   --cdp <url>    CDP endpoint (default: $SIGNALS_CDP_URL, then RealtimeX dev, then 9222)
 *   --wait <ms>    settle time after navigation or a click (default 1200)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

function fail(message) {
  process.stderr.write(`[probe-ui] ${message}\n`);
  process.exit(1);
}

/**
 * CDP endpoints, most specific first. RealtimeX exposes the Electron inspector on `electronDebug`
 * and a separate CLI browser on `cliBrowserDebug`; the app's own pages live on the former.
 */
function cdpCandidates() {
  const explicit = arg("cdp") ?? process.env.SIGNALS_CDP_URL;
  if (typeof explicit === "string") return [explicit];

  const candidates = [];
  for (const repo of ["/Users/realtimex/rtgit/realtimex-ai-app", process.env.RTX_APP_REPO]) {
    if (!repo) continue;
    try {
      const endpoints = JSON.parse(readFileSync(`${repo}/tmp/dev-runtime/endpoints.json`, "utf8"));
      for (const key of ["electronDebug", "cliBrowserDebug"]) {
        const port = endpoints?.ports?.[key];
        if (port) candidates.push(`http://127.0.0.1:${port}`);
      }
    } catch {
      // No dev runtime record; fall through to the well-known ports.
    }
  }
  candidates.push("http://127.0.0.1:9888", "http://127.0.0.1:9222");
  return [...new Set(candidates)];
}

/** A target is ours only if it is a page already showing Signals — never guess by port alone. */
async function findTarget() {
  for (const base of cdpCandidates()) {
    let tabs;
    try {
      const res = await fetch(`${base}/json`, { signal: AbortSignal.timeout(2000) });
      tabs = await res.json();
    } catch {
      continue;
    }
    const path = String(arg("path", "/dashboard"));
    const exact = tabs.find((t) => t.type === "page" && (t.url ?? "").includes(path));
    const anySignals = tabs.find((t) => t.type === "page" && /\/dashboard/.test(t.url ?? ""));
    const target = exact ?? anySignals;
    if (target) return { base, target, navigate: !exact };
  }
  return null;
}

const found = await findTarget();
if (!found) {
  fail(
    `no Signals page found on any CDP endpoint (${cdpCandidates().join(", ")}). ` +
      `Open Signals in the app, or pass --cdp.`,
  );
}

const WebSocket = require("ws");
const ws = new WebSocket(found.target.webSocketDebuggerUrl);
let nextId = 0;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 15000);
    const onMessage = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "evaluation threw");
  }
  return result?.result?.value;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const waitMs = Number(arg("wait", 1200)) || 1200;

await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
});
await send("Runtime.enable");

if (found.navigate) {
  const path = String(arg("path", "/dashboard"));
  const base = await evaluate("location.origin");
  await send("Page.enable").catch(() => {});
  await send("Page.navigate", { url: `${base}${path}` });
  await settle(waitMs);
}

const clickText = arg("click");
if (typeof clickText === "string") {
  const outcome = await evaluate(`(() => {
    const wanted = ${JSON.stringify(clickText)};
    const leaf = [...document.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && el.textContent?.trim() === wanted,
    );
    if (!leaf) return "not found: " + wanted;
    let node = leaf;
    for (let hop = 0; hop < 8 && node; hop++) {
      const button = [...node.querySelectorAll("button")].find((b) => !b.disabled);
      if (button) { button.click(); return "clicked: " + button.textContent.trim(); }
      node = node.parentElement;
    }
    return "no enabled button near: " + wanted;
  })()`);
  process.stderr.write(`[probe-ui] ${outcome}\n`);
  if (String(outcome).startsWith("not found") || String(outcome).startsWith("no enabled")) {
    ws.close();
    process.exit(1);
  }
  await settle(waitMs);
}

const expression =
  arg("dialog") === true
    ? `(() => {
         const dialog = document.querySelector('[role="dialog"]');
         if (!dialog) return { error: "no open dialog" };
         return {
           title: dialog.querySelector("h2,[role=heading]")?.textContent?.trim() ?? null,
           labels: [...dialog.querySelectorAll("label")].map((l) => l.textContent.trim()),
           buttons: [...dialog.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
         };
       })()`
    : arg("eval");

if (!expression) fail("nothing to report: pass --eval <expression> or --dialog");

try {
  const value = await evaluate(String(expression));
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} catch (error) {
  ws.close();
  fail(error instanceof Error ? error.message : String(error));
}
ws.close();
