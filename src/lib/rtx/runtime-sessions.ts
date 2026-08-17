import { getRtxAppId, resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
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

function mapLaunchHttpError(
  status: number,
  body: Record<string, unknown>
): LaunchTerminalAgentResult {
  const code = typeof body.code === "string" ? body.code : "";
  const error = typeof body.error === "string" ? body.error : "Launch failed";

  if (status === 403 || code === "PERMISSION_REQUIRED" || code === "PERMISSION_DENIED") {
    return { success: false, error, errorCode: "permission_required", httpStatus: status };
  }
  if (status === 404 || code === "APP_NOT_FOUND") {
    return { success: false, error, errorCode: "rtx_unavailable", httpStatus: status };
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

  const agentName = input.agentName?.trim() || env.SIGNALS_RTX_AGENT_NAME?.trim() || "claude";

  try {
    const response = await fetchImpl(
      `${apiBase}/sdk/desktop/runtime-sessions/launch-terminal-cli-agent`,
      {
        method: "POST",
        headers: buildAppHeaders(appId),
        body: JSON.stringify({
          workspaceSlug: input.workspaceSlug,
          threadSlug: input.threadSlug,
          agentName,
          agentType: "terminal-cli",
          interactionMode: "chat-linked",
          primarySurface: "chat",
          firstTurnDelivery: "queued",
          message: input.message,
          spawnSource: "signals-publish",
          requestedBy: "Signals",
          reason: input.reason,
        }),
      }
    );

    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body.success === false) {
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

    const body = (await response.json()) as Record<string, unknown>;
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

1. Load the \`signals-publish\` skill (and \`realtimex-signals\` for the agent-tools API) — use those exact names.
2. Call agent-tool \`get_publish_job\` with jobId "${input.jobId}" to get the full text, media file paths, and targets.
3. The author's threading/format intent is expressed in the post body. Apply each platform's best practices (e.g., split into a thread on X if the content warrants it; single post on LinkedIn).
4. Publish deterministically using the skill's publish script against the RealTimeX Browser session "signals-publish". Call \`update_publish_job\` when you start each platform.
5. After each platform, call \`complete_publish\` with the result (success requires the detected handle, post id, and URL; failures need error + errorCode from: session_expired, captcha, upload_failed, timeout, unknown).
6. If the browser isn't logged in, say so in this thread and wait for the user to sign in in the RealTimeX Browser window, then retry.

IMPORTANT: Only publish this job's content. Do not post anything else. Report a one-line summary per platform when done.`;
}
