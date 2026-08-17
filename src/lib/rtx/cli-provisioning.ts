import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";

export type RtxCliBody = Record<string, unknown>;

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
): Promise<RtxCliBody> {
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

  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `RealTimeX CLI API failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

export function getSignalsRtxWorkspaceSlug(env: EnvLike = process.env): string {
  return env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals";
}

export async function ensureRtxWorkspace(
  workspaceSlug: string,
  workspaceName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  try {
    await rtxCliRequest(
      "/cli/create-workspace",
      {
        method: "POST",
        body: JSON.stringify({ name: workspaceName, slug: workspaceSlug }),
      },
      env,
      fetchImpl
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|duplicate/i.test(message)) {
      throw error;
    }
  }
  return workspaceSlug;
}

export async function createRtxPublishThread(
  workspaceSlug: string,
  threadName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = await rtxCliRequest(
    `/cli/create-thread/${encodeURIComponent(workspaceSlug)}`,
    {
      method: "POST",
      body: JSON.stringify({ name: threadName }),
    },
    env,
    fetchImpl
  );

  const thread = body.thread as { slug?: string } | undefined;
  const slug =
    thread?.slug ??
    (typeof body.slug === "string" ? body.slug : null) ??
    (typeof body.threadSlug === "string" ? body.threadSlug : null);

  if (!slug) {
    throw new Error("RealTimeX did not return a thread slug");
  }
  return slug;
}

export function buildPublishThreadName(title: string | null | undefined): string {
  const label = (title?.trim() || "Untitled").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Publish: ${label} — ${stamp}`;
}
