import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";

export type RtxCliBody = Record<string, unknown>;

/**
 * Navigation guardrails Signals declares for the shared publish session.
 * `unrestricted` mode keeps RTX from anchoring the session to a single origin;
 * `allowedOrigins` still fences it to the platforms Signals opens.
 */
export type RtxBrowserSessionGuardrails = {
  mode: "unrestricted";
  allowedOrigins: string[];
  blockedOrigins: string[];
};

export type RtxBrowserSessionEntry = {
  sessionName: string;
  running?: boolean;
  remoteDebugPort?: number;
  runtime?: {
    status?: string;
    remoteDebugPort?: number;
    port?: number;
  };
};

function buildAppHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

async function rtxCliRequest(
  path: string,
  init: RequestInit,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ response: Response; body: RtxCliBody }> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    throw new Error("RealTimeX API is not configured");
  }

  const response = await fetchImpl(`${apiBase}${path}`, {
    ...init,
    headers: {
      ...buildAppHeaders(appId),
      ...(init.headers ?? {}),
    },
  });

  let body: RtxCliBody = {};
  try {
    body = (await response.json()) as RtxCliBody;
  } catch {
    body = {};
  }

  return { response, body };
}

/**
 * RTX guardrail denials name the origin lock but not the way out, and Signals is
 * the only side that can clear it (by re-declaring guardrails on connect), so add
 * the recovery step when the CLI reports one.
 */
function describeRtxCliFailure(body: RtxCliBody, fallback: string): string {
  const base =
    typeof body.error === "string" && body.error.trim() ? body.error.trim() : fallback;
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!reason.startsWith("guardrail-")) return base;

  return `${base} Signals could not clear the session origin lock — update RealTimeX, or delete the ${RTX_PUBLISH_SESSION_NAME} session in Settings → Browser and sign in again.`;
}

export async function listRtxBrowserSessions(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxBrowserSessionEntry[]> {
  const { response, body } = await rtxCliRequest(
    "/cli/list-browser-sessions?includeReservedSessions=true",
    { method: "GET" },
    env,
    fetchImpl
  );

  if (!response.ok || body.success === false) {
    throw new Error(
      describeRtxCliFailure(body, `Failed to list RTX browser sessions (${response.status})`)
    );
  }

  const sessions = body.sessions;
  return Array.isArray(sessions) ? (sessions as RtxBrowserSessionEntry[]) : [];
}

export function findRtxBrowserSession(
  sessions: RtxBrowserSessionEntry[],
  sessionName: string
): RtxBrowserSessionEntry | undefined {
  const target = sessionName.trim().toLowerCase();
  return sessions.find(
    (entry) => entry.sessionName?.trim().toLowerCase() === target
  );
}

export function resolveRtxDebugPort(entry: RtxBrowserSessionEntry | undefined): number | null {
  if (!entry) return null;
  const candidates = [
    entry.remoteDebugPort,
    entry.runtime?.remoteDebugPort,
    entry.runtime?.port,
  ];
  for (const value of candidates) {
    const port = Number(value);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return null;
}

export async function createRtxBrowserSession(
  input: {
    sessionName?: string;
    url?: string;
    guardrails?: RtxBrowserSessionGuardrails;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxCliBody> {
  const sessionName = input.sessionName?.trim() || RTX_PUBLISH_SESSION_NAME;
  const { response, body } = await rtxCliRequest(
    "/cli/create-browser-session",
    {
      method: "POST",
      body: JSON.stringify({
        sessionName,
        ...(input.url ? { url: input.url } : {}),
        ...(input.guardrails ? { guardrails: input.guardrails } : {}),
      }),
    },
    env,
    fetchImpl
  );

  if (!response.ok || body.success === false) {
    throw new Error(
      describeRtxCliFailure(body, `Failed to create RTX browser session (${response.status})`)
    );
  }

  return body;
}

export async function startRtxBrowserSession(
  input: { sessionName?: string; url?: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxCliBody> {
  const sessionName = input.sessionName?.trim() || RTX_PUBLISH_SESSION_NAME;
  const { response, body } = await rtxCliRequest(
    `/cli/start-browser-session/${encodeURIComponent(sessionName)}`,
    {
      method: "POST",
      body: JSON.stringify(input.url ? { url: input.url } : {}),
    },
    env,
    fetchImpl
  );

  if (!response.ok || body.success === false) {
    throw new Error(
      describeRtxCliFailure(body, `Failed to start RTX browser session (${response.status})`)
    );
  }

  return body;
}

export async function stopRtxBrowserSession(
  sessionName: string = RTX_PUBLISH_SESSION_NAME,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxCliBody> {
  const { response, body } = await rtxCliRequest(
    `/cli/stop-browser-session/${encodeURIComponent(sessionName)}`,
    { method: "POST", body: JSON.stringify({}) },
    env,
    fetchImpl
  );

  if (!response.ok || body.success === false) {
    throw new Error(
      describeRtxCliFailure(body, `Failed to stop RTX browser session (${response.status})`)
    );
  }

  return body;
}
