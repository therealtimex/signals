import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { PublishError } from "@/lib/browser/publishers/types";
import {
  parseBrowserSessions,
  parseSessionPort,
  type BrowserSessionRecord,
} from "@/lib/browser/rtx-publish/pp-cli";

export type BrowserSessionApiBody = Record<string, unknown>;

export type BrowserSessionApiClient = {
  listSessions: () => Promise<BrowserSessionRecord[]>;
  createSession: (sessionName: string, url?: string) => Promise<BrowserSessionApiBody>;
  startSession: (sessionName: string, url?: string) => Promise<BrowserSessionApiBody>;
  stopSession: (sessionName: string) => Promise<void>;
};

function buildAppHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

/** Local App browser-session API call using `x-app-id` (same contract as `/sdk/*`). */
export async function rtxBrowserSessionRequest(
  path: string,
  init: RequestInit,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<BrowserSessionApiBody> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    throw new PublishError(
      "RealTimeX API is not configured for browser sessions. Run Signals as a Local App.",
      "session_expired"
    );
  }

  const response = await fetchImpl(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...buildAppHeaders(appId),
      ...(init.headers ?? {}),
    },
  });

  let body: BrowserSessionApiBody = {};
  try {
    body = (await response.json()) as BrowserSessionApiBody;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `RealTimeX Browser API failed (${response.status})`;
    throw new PublishError(message, "session_expired");
  }

  if (body.success === false) {
    const message =
      typeof body.error === "string" ? body.error : "RealTimeX Browser API request failed";
    throw new PublishError(message, "session_expired");
  }

  return body;
}

/** Create an injectable browser-session client for embedded Local Apps. */
export function createBrowserSessionApiClient(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): BrowserSessionApiClient {
  return {
    async listSessions() {
      const body = await rtxBrowserSessionRequest(
        "/cli/list-browser-sessions",
        { method: "GET" },
        env,
        fetchImpl
      );
      return parseBrowserSessions(body);
    },

    async createSession(sessionName: string, url?: string) {
      return rtxBrowserSessionRequest(
        "/cli/create-browser-session",
        {
          method: "POST",
          body: JSON.stringify({
            sessionName,
            ...(url ? { url } : {}),
          }),
        },
        env,
        fetchImpl
      );
    },

    async startSession(sessionName: string, url?: string) {
      return rtxBrowserSessionRequest(
        `/cli/start-browser-session/${encodeURIComponent(sessionName)}`,
        {
          method: "POST",
          body: JSON.stringify(url ? { url } : {}),
        },
        env,
        fetchImpl
      );
    },

    async stopSession(sessionName: string) {
      await rtxBrowserSessionRequest(
        `/cli/stop-browser-session/${encodeURIComponent(sessionName)}`,
        { method: "POST", body: JSON.stringify({}) },
        env,
        fetchImpl
      );
    },
  };
}

export function parsePortFromApiBody(body: BrowserSessionApiBody): number | null {
  return parseSessionPort({ results: body }) ?? parseSessionPort({ results: { session: body.session } });
}
