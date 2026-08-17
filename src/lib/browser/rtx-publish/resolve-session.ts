import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { PublishError } from "@/lib/browser/publishers/types";
import { RTX_PUBLISH_SESSION_NAME, X_HOME_URL } from "@/lib/browser/rtx-publish/constants";
import { parseXContentTabsFromSession } from "@/lib/browser/rtx-publish/desktop-browser-client";
import type { RtxBrowserSessionRef } from "@/lib/browser/rtx-publish/types";
import {
  createBrowserSessionClient,
} from "@/lib/browser/rtx-publish/create-browser-session-client";
import {
  parsePortFromApiBody,
  type BrowserSessionApiClient,
} from "@/lib/browser/rtx-publish/browser-session-client";

const STANDALONE_MESSAGE =
  "X publish requires the RealTimeX Local App. Run Signals as an embedded Local App or set SIGNALS_RTX_CDP_PORT for development.";

const SESSION_MESSAGE =
  "X is not logged in on RealTimeX Browser. Open the signals-publish session in RealTimeX Browser and sign in to X.";

export type ResolveSessionDeps = {
  browserSessionApi: BrowserSessionApiClient;
  env: EnvLike;
};

function defaultDeps(env: EnvLike = process.env): ResolveSessionDeps {
  return {
    browserSessionApi: createBrowserSessionClient(env),
    env,
  };
}

/** Dev/test override: attach directly without session management. */
export function resolveCdpPortOverride(env: EnvLike = process.env): number | null {
  const raw = env.SIGNALS_RTX_CDP_PORT?.trim();
  if (!raw) return null;
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : null;
}

/**
 * Resolve (or start) the fixed `signals-publish` RTX Browser session.
 * Embedded Local Apps use the `x-app-id` HTTP API (Approved v1.1 §4.3).
 */
export async function resolveRtxPublishSession(
  deps: Partial<ResolveSessionDeps> = {}
): Promise<RtxBrowserSessionRef> {
  const env = deps.env ?? process.env;
  const { browserSessionApi: api } = { ...defaultDeps(env), ...deps };

  const overridePort = resolveCdpPortOverride(env);
  if (overridePort !== null) {
    return {
      sessionName: RTX_PUBLISH_SESSION_NAME,
      remoteDebugPort: overridePort,
    };
  }

  if (!isRtxEmbedded(env)) {
    throw new PublishError(STANDALONE_MESSAGE, "session_expired");
  }

  try {
    const sessions = await api.listSessions();
    let session = sessions.find((s) => s.sessionName === RTX_PUBLISH_SESSION_NAME);

    if (!session) {
      const createBody = await api.createSession(RTX_PUBLISH_SESSION_NAME, X_HOME_URL);
      const port = parsePortFromApiBody(createBody);
      if (port !== null) {
        return {
          sessionName: RTX_PUBLISH_SESSION_NAME,
          remoteDebugPort: port,
          tabs: parseXContentTabsFromSession(createBody.session ?? createBody),
        };
      }
      const refreshed = await api.listSessions();
      session = refreshed.find((s) => s.sessionName === RTX_PUBLISH_SESSION_NAME);
    }

    if (!session) {
      throw new PublishError(SESSION_MESSAGE, "session_expired");
    }

    if (!session.running) {
      const startBody = await api.startSession(RTX_PUBLISH_SESSION_NAME);
      const port = parsePortFromApiBody(startBody) ?? session.remoteDebugPort;
      if (port !== null) {
        return {
          sessionName: RTX_PUBLISH_SESSION_NAME,
          remoteDebugPort: port,
          tabs: parseXContentTabsFromSession(startBody.session ?? startBody),
        };
      }
    }

    return {
      sessionName: RTX_PUBLISH_SESSION_NAME,
      remoteDebugPort: session.remoteDebugPort,
      tabs: session.tabs,
    };
  } catch (err) {
    if (err instanceof PublishError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new PublishError(
      `Failed to start RealTimeX Browser for publish: ${message}. ${SESSION_MESSAGE}`,
      "session_expired"
    );
  }
}

/** Stop the publish session after auto-mode publish (never delete). */
export async function stopRtxPublishSession(
  deps: Partial<ResolveSessionDeps> = {}
): Promise<void> {
  const env = deps.env ?? process.env;
  const { browserSessionApi: api } = { ...defaultDeps(env), ...deps };
  if (resolveCdpPortOverride(env) !== null) return;

  try {
    await api.stopSession(RTX_PUBLISH_SESSION_NAME);
  } catch {
    // Best-effort stop; session may already be stopped.
  }
}
