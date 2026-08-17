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

async function rtxCliRequestOk(
  path: string,
  init: RequestInit,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxCliBody> {
  const { response, body } = await rtxCliRequest(path, init, env, fetchImpl);
  if (!response.ok) {
    const message =
      typeof body.error === "string"
        ? body.error
        : `RealTimeX CLI API failed (${response.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return body;
}

export function getSignalsRtxWorkspaceSlug(env: EnvLike = process.env): string {
  return env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals";
}

function extractWorkspaceSlug(body: RtxCliBody, fallback: string): string {
  const workspace = body.workspace as { slug?: string } | undefined;
  return (
    workspace?.slug ??
    (typeof body.slug === "string" ? body.slug : null) ??
    fallback
  );
}

export async function ensureRtxWorkspace(
  workspaceSlug: string,
  workspaceName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const slug = workspaceSlug.trim();

  try {
    await rtxCliRequestOk(
      `/cli/get-workspace/${encodeURIComponent(slug)}`,
      { method: "GET" },
      env,
      fetchImpl
    );
    return slug;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 404) {
      throw error;
    }
  }

  const created = await rtxCliRequestOk(
    "/cli/create-workspace",
    {
      method: "POST",
      body: JSON.stringify({ name: workspaceName, slug }),
    },
    env,
    fetchImpl
  );

  const resolvedSlug = extractWorkspaceSlug(created, slug);
  if (resolvedSlug !== slug) {
    throw new Error(
      `Workspace slug mismatch: expected "${slug}", got "${resolvedSlug}"`
    );
  }
  return resolvedSlug;
}

export async function createRtxPublishThread(
  workspaceSlug: string,
  threadName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = await rtxCliRequestOk(
    `/cli/create-thread/${encodeURIComponent(workspaceSlug)}`,
    {
      method: "POST",
      body: JSON.stringify({ name: threadName }),
    },
    env,
    fetchImpl
  );

  const thread = body.thread as { slug?: string } | undefined;
  const threadSlug =
    thread?.slug ??
    (typeof body.slug === "string" ? body.slug : null) ??
    (typeof body.threadSlug === "string" ? body.threadSlug : null);

  if (!threadSlug) {
    throw new Error("RealTimeX did not return a thread slug");
  }
  return threadSlug;
}

export function buildPublishThreadName(title: string | null | undefined): string {
  const label = (title?.trim() || "Untitled").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Publish: ${label} — ${stamp}`;
}
