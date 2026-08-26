/**
 * Resolve the Signals Local App page inside the running RealTimeX Dev app.
 *
 * Every other flow needs this, and getting it wrong is the expensive failure: a
 * CDP page target keeps advertising its intended URL after the Local App stops,
 * so the target *looks* right while the document is actually `chrome-error://`.
 * An automation that matched on the target URL alone would evaluate against an
 * error page, see zero UI, and report the feature broken when the app is simply
 * not running. Diagnosing which of those it is has to be this flow's job.
 */
import WebSocket from "ws";

export const DEFAULT_CDP_URL = "http://127.0.0.1:9888";

/** A loaded document, as opposed to Chrome's error placeholder. */
export function isLoadedDocument(href) {
  const value = String(href || "");
  if (!value) return false;
  return !value.startsWith("chrome-error://") && !value.startsWith("about:blank");
}

/**
 * Decide what the observed state means, separately from how it was observed, so
 * the mapping from symptom to diagnosis is testable without a browser.
 *
 * @returns {{ok: boolean, code: string, message: string}}
 */
export function classifySignalsTarget({ cdpReachable, target, documentHref, healthStatus }) {
  if (!cdpReachable) {
    return {
      ok: false,
      code: "dev_app_unreachable",
      message:
        "RealTimeX Dev app is not reachable over CDP. Start it with `yarn dev:all` in the realtimex-ai-app checkout.",
    };
  }
  if (!target) {
    return {
      ok: false,
      code: "signals_not_open",
      message:
        "No Signals Local App page is open in the Dev app. Open the Local App from the RealTimeX UI first.",
    };
  }
  if (!isLoadedDocument(documentHref)) {
    return {
      ok: false,
      code: "local_app_stopped",
      message:
        `The Dev app still lists "${target.url}", but its document is "${documentHref}" — the page did not load. ` +
        "The Signals Local App is almost certainly stopped; start it from the RealTimeX UI and retry. " +
        "Do not assert against this target: it will read as an empty UI.",
    };
  }
  if (healthStatus !== 200) {
    return {
      ok: false,
      code: "server_unhealthy",
      message:
        `The page loaded but /api/health returned ${healthStatus ?? "no response"}. ` +
        "The Local App is serving a stale document; restart it rather than trusting the UI.",
    };
  }
  return { ok: true, code: "ready", message: "Signals Local App is loaded and healthy." };
}

/** Extract the Local App origin from a CDP target URL. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function evaluateHref(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: "location.href", returnByValue: true },
      }),
    );
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP evaluate timed out")), 10_000);
      ws.on("message", (raw) => {
        const data = JSON.parse(raw);
        if (data.id === 1) {
          clearTimeout(timer);
          resolve(data);
        }
      });
      ws.once("error", reject);
    });
    return message.result?.result?.value ?? null;
  } finally {
    ws.close();
  }
}

export async function resolveSignalsTarget({
  cdpUrl = process.env.RTX_DEV_CDP_URL || DEFAULT_CDP_URL,
  fetchImpl = fetch,
} = {}) {
  let targets = null;
  try {
    const response = await fetchImpl(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(5_000) });
    if (response.ok) targets = await response.json();
  } catch {
    targets = null;
  }

  if (targets === null) {
    return { ...classifySignalsTarget({ cdpReachable: false }), cdpUrl };
  }

  // Signals is a Local App on an assigned port, so match its dashboard route
  // rather than a fixed port — 3010 is only the common default.
  const target = targets.find(
    (candidate) =>
      candidate.type === "page" && /\/dashboard(\/|$)/.test(String(candidate.url || "")),
  );

  if (!target) {
    return { ...classifySignalsTarget({ cdpReachable: true, target: null }), cdpUrl };
  }

  let documentHref = null;
  try {
    documentHref = await evaluateHref(target.webSocketDebuggerUrl);
  } catch {
    documentHref = null;
  }

  const origin = originOf(target.url);
  let healthStatus = null;
  if (isLoadedDocument(documentHref) && origin) {
    try {
      const health = await fetchImpl(`${origin}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      healthStatus = health.status;
    } catch {
      healthStatus = null;
    }
  }

  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target,
    documentHref,
    healthStatus,
  });

  return {
    ...verdict,
    cdpUrl,
    origin,
    targetUrl: target.url,
    documentHref,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  };
}
