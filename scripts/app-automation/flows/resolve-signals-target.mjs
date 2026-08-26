/**
 * Resolve the Signals Local App page inside the running RealTimeX Dev app.
 *
 * Every other flow needs this, and getting it wrong is the expensive failure: a
 * CDP page target keeps advertising its intended URL after the Local App stops,
 * so the target *looks* right while the document is actually `chrome-error://`.
 * An automation that matched on the target URL alone would evaluate against an
 * error page, see zero UI, and report the feature broken when the app is simply
 * not running. Diagnosing which of those it is has to be this flow's job.
 *
 * Uses Node's global WebSocket (Node 22+) rather than `ws`, which is only a
 * transitive dependency here and would break an install without dev deps.
 */
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
export function classifySignalsTarget({
  cdpReachable,
  target,
  documentHref,
  healthStatus,
  healthApp,
  healthState,
}) {
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
  if (healthApp !== "signals") {
    // Wrong app on this port. Local App ports get reassigned, so a 200 only
    // proves *something* is listening — the remedy is to re-resolve the port.
    return {
      ok: false,
      code: "not_signals",
      message:
        `/api/health answered 200 but reported app="${healthApp ?? "none"}". ` +
        "Something other than Signals is serving this port; re-resolve the Local App port before asserting.",
    };
  }
  if (healthState !== "ok") {
    // Signals *is* answering, just not healthy. Sending the operator to
    // re-resolve the port here would be actively misleading.
    return {
      ok: false,
      code: "server_unhealthy",
      message:
        `Signals answered /api/health with status="${healthState ?? "none"}". ` +
        "The right app is on this port but reports itself unhealthy; restart it before asserting.",
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
  const socket = new WebSocket(webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      // A stalled handshake fires neither `open` nor `error`, so without this the
      // CLI waits forever. Every other wait here is bounded; this one must be too.
      // `timer` is declared before `cleanup` so the reference is valid whenever a
      // handler runs, rather than relying on handlers always being asynchronous.
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("CDP socket failed to open"));
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("CDP socket handshake timed out"));
      }, 10_000);
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: "location.href", returnByValue: true },
      }),
    );

    return await new Promise((resolve, reject) => {
      // Every exit path clears the timer. Leaving it pending on the error path
      // keeps the event loop alive and hangs the CLI for the full timeout after
      // a failure that was already known. Declared before `cleanup` for the same
      // reason as the open phase.
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
      };
      const onMessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          return;
        }
        if (data.id !== 1) return;
        cleanup();
        resolve(data.result?.result?.value ?? null);
      };
      const onError = () => {
        cleanup();
        reject(new Error("CDP socket error while evaluating"));
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("CDP evaluate timed out"));
      }, 10_000);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
    });
  } finally {
    socket.close();
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
  let healthApp = null;
  let healthState = null;
  if (isLoadedDocument(documentHref) && origin) {
    try {
      const health = await fetchImpl(`${origin}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      healthStatus = health.status;
      if (health.ok) {
        const body = await health.json().catch(() => null);
        healthApp = body?.app ?? null;
        healthState = body?.status ?? null;
      }
    } catch {
      healthStatus = null;
    }
  }

  const verdict = classifySignalsTarget({
    cdpReachable: true,
    target,
    documentHref,
    healthStatus,
    healthApp,
    healthState,
  });

  return {
    ...verdict,
    cdpUrl,
    origin,
    targetUrl: target.url,
    documentHref,
    healthApp,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  };
}
