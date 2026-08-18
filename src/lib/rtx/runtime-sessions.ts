import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { getWorkspaceDefaultTerminalAgent } from "@/lib/rtx/cli-provisioning";
import type { PublishLaunchErrorCode } from "@/lib/publish/types";

export type RuntimeSessionDescriptor = {
  id: string;
  linkage?: {
    workspaceSlug?: string;
    threadSlug?: string;
  };
};

export type LaunchTerminalAgentInput = {
  workspaceSlug: string;
  threadSlug: string;
  message: string;
  reason: string;
  agentName?: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

export type LaunchTerminalAgentResult =
  | { success: true; descriptor: RuntimeSessionDescriptor }
  | { success: false; error: string; errorCode: PublishLaunchErrorCode; httpStatus?: number };

function buildAppHeaders(appId: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-app-id": appId,
  };
}

const RTX_RUNTIME_UNAVAILABLE_MESSAGE =
  "RealTimeX desktop runtime sessions are not available on this host. Ensure the RealTimeX app is running and has granted the desktop.runtime-sessions permission.";

export async function readRtxJsonBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const trimmed = text.trim();
    if (!response.ok) {
      return {
        error:
          trimmed && trimmed.length < 200
            ? trimmed
            : `RealTimeX API error (${response.status})`,
        code: response.status === 404 ? "RTX_RUNTIME_SESSIONS_UNAVAILABLE" : undefined,
      };
    }
    return { error: "RealTimeX returned an invalid response" };
  }
}

function mapLaunchHttpError(
  status: number,
  body: Record<string, unknown>
): LaunchTerminalAgentResult {
  const code = typeof body.code === "string" ? body.code : "";
  const error =
    typeof body.error === "string"
      ? body.error
      : status === 404
        ? RTX_RUNTIME_UNAVAILABLE_MESSAGE
        : "Launch failed";

  if (status === 403 || code === "PERMISSION_REQUIRED" || code === "PERMISSION_DENIED") {
    return { success: false, error, errorCode: "permission_required", httpStatus: status };
  }
  if (
    status === 404 ||
    code === "APP_NOT_FOUND" ||
    code === "RTX_RUNTIME_SESSIONS_UNAVAILABLE"
  ) {
    return {
      success: false,
      error: error || RTX_RUNTIME_UNAVAILABLE_MESSAGE,
      errorCode: "rtx_unavailable",
      httpStatus: status,
    };
  }
  if (status === 503 || code === "DESKTOP_RUNTIME_SESSION_RELAY_ERROR") {
    return {
      success: false,
      error: error || "RealTimeX desktop isn't running",
      errorCode: "rtx_unavailable",
      httpStatus: status,
    };
  }
  return { success: false, error, errorCode: "launch_failed", httpStatus: status };
}

type ResolvedLaunchAgent = {
  agentName: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

function buildLaunchRequestBody(
  input: LaunchTerminalAgentInput,
  agent: ResolvedLaunchAgent
): Record<string, unknown> {
  return {
    workspaceSlug: input.workspaceSlug,
    threadSlug: input.threadSlug,
    agentName: agent.agentName,
    ...(agent.agentId ? { agentId: agent.agentId } : {}),
    ...(agent.providerId ? { providerId: agent.providerId } : {}),
    ...(agent.modelId ? { modelId: agent.modelId } : {}),
    agentType: "terminal-cli",
    interactionMode: "chat-linked",
    primarySurface: "chat",
    firstTurnDelivery: "queued",
    message: input.message,
    spawnSource: "signals-publish",
    requestedBy: "Signals",
    reason: input.reason,
  };
}

async function resolveLaunchTerminalAgent(
  input: LaunchTerminalAgentInput,
  env: EnvLike,
  fetchImpl: typeof fetch
): Promise<ResolvedLaunchAgent> {
  const workspaceDefault = await getWorkspaceDefaultTerminalAgent(
    input.workspaceSlug,
    env,
    fetchImpl
  );

  return {
    agentName:
      input.agentName?.trim() ||
      workspaceDefault?.agentName ||
      env.SIGNALS_RTX_AGENT_NAME?.trim() ||
      "claude",
    agentId: input.agentId ?? workspaceDefault?.agentId,
    providerId: input.providerId ?? workspaceDefault?.providerId,
    modelId: input.modelId ?? workspaceDefault?.modelId,
  };
}

function parseCliSessionDescriptor(
  body: Record<string, unknown>,
  input: LaunchTerminalAgentInput
): RuntimeSessionDescriptor | null {
  const session = body.session as Record<string, unknown> | undefined;
  const id =
    typeof session?.id === "string"
      ? session.id
      : typeof session?.sessionId === "string"
        ? session.sessionId
        : null;
  if (!id || !session) return null;

  return {
    id,
    linkage: {
      workspaceSlug:
        typeof session.workspaceSlug === "string"
          ? session.workspaceSlug
          : input.workspaceSlug,
      threadSlug:
        typeof session.threadSlug === "string" ? session.threadSlug : input.threadSlug,
    },
  };
}

async function launchTerminalCliAgentViaCli(
  input: LaunchTerminalAgentInput,
  agent: ResolvedLaunchAgent,
  appId: string,
  apiBase: string,
  fetchImpl: typeof fetch
): Promise<LaunchTerminalAgentResult> {
  const response = await fetchImpl(`${apiBase}/cli/open-terminal-session`, {
    method: "POST",
    headers: buildAppHeaders(appId),
    body: JSON.stringify(buildLaunchRequestBody(input, agent)),
  });

  const body = await readRtxJsonBody(response);
  if (!response.ok || body.success === false) {
    return mapLaunchHttpError(response.status, body);
  }

  const descriptor = parseCliSessionDescriptor(body, input);
  if (!descriptor) {
    return {
      success: false,
      error: "Launch succeeded but no session descriptor was returned",
      errorCode: "launch_failed",
      httpStatus: response.status,
    };
  }

  return { success: true, descriptor };
}

function shouldFallbackToCliLaunch(status: number, body: Record<string, unknown>): boolean {
  if (status !== 404) return false;
  const code = typeof body.code === "string" ? body.code : "";
  return code === "RTX_RUNTIME_SESSIONS_UNAVAILABLE" || code === "" || body.error === "Not Found";
}

export async function launchTerminalCliAgent(
  input: LaunchTerminalAgentInput,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<LaunchTerminalAgentResult> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    return {
      success: false,
      error: "Publishing requires the RealTimeX Local App",
      errorCode: "standalone",
    };
  }

  const agent = await resolveLaunchTerminalAgent(input, env, fetchImpl);

  try {
    const response = await fetchImpl(
      `${apiBase}/sdk/desktop/runtime-sessions/launch-terminal-cli-agent`,
      {
        method: "POST",
        headers: buildAppHeaders(appId),
        body: JSON.stringify(buildLaunchRequestBody(input, agent)),
      }
    );

    const body = await readRtxJsonBody(response);
    if (!response.ok || body.success === false) {
      if (shouldFallbackToCliLaunch(response.status, body)) {
        return launchTerminalCliAgentViaCli(input, agent, appId, apiBase, fetchImpl);
      }
      return mapLaunchHttpError(response.status, body);
    }

    const descriptor = body.descriptor as RuntimeSessionDescriptor | undefined;
    if (!descriptor?.id) {
      return {
        success: false,
        error: "Launch succeeded but no session descriptor was returned",
        errorCode: "launch_failed",
        httpStatus: response.status,
      };
    }

    return { success: true, descriptor };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Launch request failed",
      errorCode: "rtx_unavailable",
    };
  }
}

export async function openRtxRuntimeLauncher(
  input: { workspaceSlug: string; threadSlug: string; reason?: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ success: boolean; error?: string }> {
  const appId = getRtxAppId(env);
  const apiBase = resolveRtxApiBase(env);
  if (!appId || !apiBase) {
    return { success: false, error: "RealTimeX API is not configured" };
  }

  try {
    const response = await fetchImpl(
      `${apiBase}/sdk/desktop/runtime-sessions/open-launcher`,
      {
        method: "POST",
        headers: buildAppHeaders(appId),
        body: JSON.stringify({
          workspaceSlug: input.workspaceSlug,
          threadSlug: input.threadSlug,
          reason: input.reason ?? "Signals publish thread",
          requestedBy: "Signals",
        }),
      }
    );

    const body = await readRtxJsonBody(response);
    if (!response.ok || body.success === false) {
      return {
        success: false,
        error: typeof body.error === "string" ? body.error : "Failed to open launcher",
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Open launcher failed",
    };
  }
}

export function buildPublishAgentInitialMessage(input: {
  jobId: string;
  contentItemId: string;
  title: string | null | undefined;
  platforms: string[];
  signalsBaseUrl: string;
}): string {
  const title = input.title?.trim() || "Untitled";
  const platformList = input.platforms.join(", ");
  return `You are the publish agent for Signals CRM.

Job: ${input.jobId} — publish content item "${title}" (${input.contentItemId}) to: ${platformList}.
Signals base URL: ${input.signalsBaseUrl}

Signals is already running — do not start or manage Local Apps via pp-cli.
Verify: curl -s ${input.signalsBaseUrl}/api/health

1. Call agent-tool \`get_publish_job\` with jobId "${input.jobId}" via POST ${input.signalsBaseUrl}/api/agent-tools/invoke.
2. If workspace skill scripts exist, you may use \`signals-publish\` and \`realtimex-signals\` scripts under \`.claude/skills/\`; otherwise call agent-tools directly at the base URL above.
3. The author's threading/format intent is expressed in the post body. Apply each platform's best practices (e.g., split into a thread on X if the content warrants it; single post on LinkedIn).
4. Publish deterministically using the skill's publish script against the RealTimeX Browser session "signals-publish". Call \`update_publish_job\` when you start each platform.
5. After each platform, call \`complete_publish\` with the result (success requires the detected handle, post id, and URL; failures need error + errorCode from: session_expired, captcha, upload_failed, timeout, unknown).
6. If the browser isn't logged in, say so in this thread and wait for the user to sign in in the RealTimeX Browser window, then retry.

IMPORTANT: Only publish this job's content. Do not post anything else. Report a one-line summary per platform when done.`;
}
