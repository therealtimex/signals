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

export async function resolveSignalsRtxWorkspaceSlug(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const preferredSlug = getSignalsRtxWorkspaceSlug(env);

  try {
    await rtxCliRequestOk(
      `/cli/get-workspace/${encodeURIComponent(preferredSlug)}`,
      { method: "GET" },
      env,
      fetchImpl,
    );
    return preferredSlug;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 404) {
      throw error;
    }
  }

  const existingSlug = await findExistingRtxWorkspaceSlug(
    preferredSlug,
    "Signals",
    env,
    fetchImpl,
  );
  return existingSlug ?? preferredSlug;
}

function extractWorkspaceSlug(body: RtxCliBody, fallback: string): string {
  const workspace = body.workspace as { slug?: string } | undefined;
  return (
    workspace?.slug ??
    (typeof body.slug === "string" ? body.slug : null) ??
    fallback
  );
}

type ListedWorkspace = { slug?: string; name?: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesWorkspaceName(candidate: string, workspaceName: string): boolean {
  if (candidate === workspaceName) return true;
  const pattern = new RegExp(`^${escapeRegExp(workspaceName)} \\(\\d+\\)$`);
  return pattern.test(candidate);
}

function rankWorkspaceMatch(
  workspace: ListedWorkspace,
  preferredSlug: string,
  workspaceName: string
): number {
  if (workspace.slug === preferredSlug) return 0;
  if (workspace.name === workspaceName) return 1;
  const suffixMatch = workspace.name?.match(new RegExp(`^${escapeRegExp(workspaceName)} \\((\\d+)\\)$`));
  if (suffixMatch) return 2 + Number.parseInt(suffixMatch[1], 10);
  return Number.MAX_SAFE_INTEGER;
}

function pickExistingWorkspaceSlug(
  workspaces: ListedWorkspace[],
  preferredSlug: string,
  workspaceName: string
): string | null {
  const matches = workspaces.filter(
    (workspace) =>
      typeof workspace.slug === "string" &&
      typeof workspace.name === "string" &&
      matchesWorkspaceName(workspace.name, workspaceName)
  );
  if (matches.length === 0) return null;

  matches.sort(
    (left, right) =>
      rankWorkspaceMatch(left, preferredSlug, workspaceName) -
      rankWorkspaceMatch(right, preferredSlug, workspaceName)
  );

  return matches[0]?.slug ?? null;
}

async function findExistingRtxWorkspaceSlug(
  preferredSlug: string,
  workspaceName: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const { response, body } = await rtxCliRequest(
    "/cli/list-workspaces",
    { method: "GET" },
    env,
    fetchImpl
  );
  if (!response.ok) return null;

  const workspaces = Array.isArray(body.workspaces)
    ? (body.workspaces as ListedWorkspace[])
    : [];
  return pickExistingWorkspaceSlug(workspaces, preferredSlug, workspaceName);
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

  const existingSlug = await findExistingRtxWorkspaceSlug(
    slug,
    workspaceName,
    env,
    fetchImpl
  );
  if (existingSlug) {
    return existingSlug;
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

  // RTX may dedupe slugs (e.g. "signals" -> "signals-2") when the name already exists.
  return extractWorkspaceSlug(created, slug);
}

export type WorkspaceTerminalAgentRef = {
  agentName: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

export function parseWorkspaceDefaultTerminalAgent(
  body: RtxCliBody
): WorkspaceTerminalAgentRef | null {
  const workspace = body.workspace as Record<string, unknown> | undefined;
  const configs = workspace?.workspace_configs as Record<string, unknown> | undefined;
  const rawDefaultAgent = configs?.defaultAgent;

  let parsed: Record<string, unknown> | null = null;
  if (typeof rawDefaultAgent === "string" && rawDefaultAgent.trim()) {
    try {
      const candidate = JSON.parse(rawDefaultAgent) as unknown;
      if (typeof candidate === "object" && candidate !== null) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  } else if (typeof rawDefaultAgent === "object" && rawDefaultAgent !== null) {
    parsed = rawDefaultAgent as Record<string, unknown>;
  }

  if (!parsed) return null;

  const agentName = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!agentName) return null;

  const terminal = parsed.terminal as Record<string, unknown> | undefined;
  const modelId =
    typeof terminal?.modelId === "string"
      ? terminal.modelId
      : typeof terminal?.defaultModelId === "string"
        ? terminal.defaultModelId
        : undefined;

  return {
    agentName,
    agentId: typeof parsed.id === "string" ? parsed.id : undefined,
    providerId: typeof terminal?.providerId === "string" ? terminal.providerId : undefined,
    modelId,
  };
}

export async function getWorkspaceDefaultTerminalAgent(
  workspaceSlug: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<WorkspaceTerminalAgentRef | null> {
  const slug = workspaceSlug.trim();
  if (!slug) return null;

  try {
    const body = await rtxCliRequestOk(
      `/cli/get-workspace/${encodeURIComponent(slug)}`,
      { method: "GET" },
      env,
      fetchImpl
    );
    return parseWorkspaceDefaultTerminalAgent(body);
  } catch {
    return null;
  }
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

export const NETWORK_SNOWBALL_DISPATCH_THREAD_SLUG = "network-snowball";
export const NETWORK_SNOWBALL_DISPATCH_THREAD_NAME = "Network Snowball";

type ListedThread = { slug?: string; name?: string };

export async function listRtxWorkspaceThreads(
  workspaceSlug: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ slug: string; name: string }> | null> {
  const slug = workspaceSlug.trim();
  if (!slug) return null;

  try {
    const body = await rtxCliRequestOk(
      `/cli/list-threads/${encodeURIComponent(slug)}`,
      { method: "GET" },
      env,
      fetchImpl,
    );
    const threads = Array.isArray(body.threads)
      ? (body.threads as ListedThread[])
      : [];
    return threads.flatMap((thread) => {
      if (typeof thread.slug !== "string" || typeof thread.name !== "string") {
        return [];
      }
      return [{ slug: thread.slug, name: thread.name }];
    });
  } catch {
    // null means "unknown", not "none". Collapsing the two would let a transient
    // listing failure look like an empty workspace and create a duplicate thread.
    return null;
  }
}

/**
 * Resolve the workspace thread Snowball calendar dispatches should hand off to.
 *
 * Prefers the legacy `network-snowball` slug when present, otherwise reuses an
 * existing "Network Snowball" thread, and only creates one when none exists.
 */
export async function resolveNetworkSnowballDispatchThread(
  workspaceSlug: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const workspace = workspaceSlug.trim();
  if (!workspace) {
    throw new Error("Workspace slug is required to resolve a Network Snowball thread");
  }

  const preferredPresence = await getRtxThreadPresence(
    workspace,
    NETWORK_SNOWBALL_DISPATCH_THREAD_SLUG,
    env,
    fetchImpl,
  );
  if (preferredPresence === "exists") {
    return NETWORK_SNOWBALL_DISPATCH_THREAD_SLUG;
  }

  const threads = await listRtxWorkspaceThreads(workspace, env, fetchImpl);

  // Pick deterministically when several exist, so concurrent resolvers that each
  // created one still converge on the same target rather than splitting history.
  const pickStable = (matches: Array<{ slug: string; name: string }>) =>
    matches.length === 0
      ? null
      : [...matches].sort((a, b) => a.slug.localeCompare(b.slug))[0].slug;

  if (threads !== null) {
    const exact = pickStable(
      threads.filter(
        (thread) => thread.name === NETWORK_SNOWBALL_DISPATCH_THREAD_NAME,
      ),
    );
    if (exact) return exact;
  }

  // Only create when RTX confirmed the legacy slug is absent *and* the listing
  // succeeded. A failed listing is unknown, not empty, and creating on unknown is
  // how duplicate threads appear.
  if (preferredPresence === "missing" && threads !== null) {
    return createRtxPublishThread(
      workspace,
      NETWORK_SNOWBALL_DISPATCH_THREAD_NAME,
      env,
      fetchImpl,
    );
  }

  // Presence or listing could not be confirmed; reuse anything plausible rather
  // than creating blindly.
  const fallback =
    threads === null
      ? null
      : pickStable(
          threads.filter((thread) =>
            thread.name.toLowerCase().includes("network snowball"),
          ),
        );
  if (fallback) return fallback;

  return NETWORK_SNOWBALL_DISPATCH_THREAD_SLUG;
}

/**
 * Whether a thread slug still resolves in the workspace.
 *
 * `"unknown"` means RealTimeX could not answer (transient/unconfigured), which is
 * deliberately distinct from `"missing"`: callers must not re-create a thread just
 * because the check failed.
 */
export type RtxThreadPresence = "exists" | "missing" | "unknown";

export async function getRtxThreadPresence(
  workspaceSlug: string,
  threadSlug: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<RtxThreadPresence> {
  if (!workspaceSlug.trim() || !threadSlug.trim()) return "missing";

  try {
    const { response } = await rtxCliRequest(
      `/cli/get-thread/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(threadSlug)}`,
      { method: "GET" },
      env,
      fetchImpl
    );
    if (response.ok) return "exists";
    if (response.status === 404) return "missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function buildPublishThreadName(title: string | null | undefined): string {
  const label = (title?.trim() || "Untitled").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Publish: ${label} — ${stamp}`;
}
