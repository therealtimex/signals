import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { PublishError } from "@/lib/browser/publishers/types";
import { scoreXContentPageUrl } from "@/lib/browser/rtx-publish/x-publish-url";

export type DesktopBrowserApiBody = Record<string, unknown>;

export type BrowserTabRecord = {
  id: number | null;
  ref: string | null;
  url: string;
  title: string;
  isActive: boolean;
};

export type DesktopBrowserApiClient = {
  listSessions: (includeReservedSessions?: boolean) => Promise<DesktopBrowserApiBody>;
  evaluateTab: (tabRef: string, expression: string) => Promise<DesktopBrowserApiBody>;
  focusTab: (tabRef: string) => Promise<DesktopBrowserApiBody>;
};

function buildAppHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

async function rtxDesktopBrowserRequest(
  path: string,
  init: RequestInit,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<DesktopBrowserApiBody> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    throw new PublishError(
      "RealTimeX desktop browser API is not configured. Run Signals as a Local App.",
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

  let body: DesktopBrowserApiBody = {};
  try {
    body = (await response.json()) as DesktopBrowserApiBody;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `RealTimeX desktop browser API failed (${response.status})`;
    throw new PublishError(message, "session_expired");
  }

  if (body.success === false) {
    const message =
      typeof body.error === "string" ? body.error : "RealTimeX desktop browser API request failed";
    throw new PublishError(message, "session_expired");
  }

  return body;
}

export function createDesktopBrowserApiClient(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): DesktopBrowserApiClient {
  return {
    async listSessions(includeReservedSessions = true) {
      const query = includeReservedSessions ? "?includeReservedSessions=true" : "";
      return rtxDesktopBrowserRequest(
        `/sdk/desktop/browser/sessions${query}`,
        { method: "GET" },
        env,
        fetchImpl
      );
    },

    async evaluateTab(tabRef, expression) {
      return rtxDesktopBrowserRequest(
        `/sdk/desktop/browser/tabs/${encodeURIComponent(tabRef)}/evaluate`,
        {
          method: "POST",
          body: JSON.stringify({ expression }),
        },
        env,
        fetchImpl
      );
    },

    async focusTab(tabRef) {
      return rtxDesktopBrowserRequest(
        `/sdk/desktop/browser/tabs/${encodeURIComponent(tabRef)}/focus`,
        {
          method: "POST",
          body: JSON.stringify({ focusWindow: false }),
        },
        env,
        fetchImpl
      );
    },
  };
}

export function parseBrowserTabRecord(raw: unknown): BrowserTabRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : "";
  if (!url) return null;

  const id = typeof record.id === "number" ? record.id : null;
  const ref = typeof record.ref === "string" ? record.ref : null;

  return {
    id,
    ref,
    url,
    title: typeof record.title === "string" ? record.title : "",
    isActive: Boolean(record.isActive),
  };
}

export function parseXContentTabsFromSession(session: unknown): BrowserTabRecord[] {
  if (!session || typeof session !== "object") return [];
  const record = session as Record<string, unknown>;
  const tabs = Array.isArray(record.tabs) ? record.tabs : [];
  return tabs
    .map(parseBrowserTabRecord)
    .filter((tab): tab is BrowserTabRecord => tab !== null && scoreXContentPageUrl(tab.url) >= 0)
    .sort((left, right) => scoreXContentPageUrl(right.url) - scoreXContentPageUrl(left.url));
}

export function findPublishSessionRecord(
  body: DesktopBrowserApiBody,
  sessionName: string
): Record<string, unknown> | null {
  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  const match = sessions.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as Record<string, unknown>).sessionName === sessionName;
  });
  return match && typeof match === "object" ? (match as Record<string, unknown>) : null;
}
