import { getContentItem, updateContentItem } from "@/lib/db/queries/content";
import {
  createPublishJob,
  markPublishJobLaunchFailed,
  supersedeActiveJobsForContentItem,
  syncItemStatusFromJob,
  updatePublishJobRtxRefs,
} from "@/lib/db/queries/publish-jobs";
import type { PublishJobPayload, PublishPlatformTarget } from "@/lib/publish/types";
import {
  buildPublishThreadName,
  createRtxPublishThread,
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded } from "@/lib/rtx/env";
import {
  buildPublishAgentInitialMessage,
  launchTerminalCliAgent,
} from "@/lib/rtx/runtime-sessions";

const SENDABLE_ITEM_STATUSES = new Set(["draft", "approved", "failed"]);

export type SendToAgentInput = {
  contentItemId: string;
  platforms: PublishPlatformTarget[];
  text: string;
  mediaAssetIds?: string[];
};

export type SendToAgentResult =
  | {
      success: true;
      jobId: string;
      rtxWorkspaceSlug: string;
      rtxThreadSlug: string;
      status: "queued";
    }
  | {
      success: false;
      error: string;
      errorCode: string;
      httpStatus: number;
    };

function resolveSignalsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT?.trim() || "3010";
  return `http://127.0.0.1:${port}`;
}

export async function sendContentToAgent(
  input: SendToAgentInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SendToAgentResult> {
  if (!isRtxEmbedded(env)) {
    return {
      success: false,
      error: "Publishing requires the RealTimeX Local App",
      errorCode: "standalone",
      httpStatus: 400,
    };
  }

  const item = getContentItem(input.contentItemId);
  if (!item) {
    return {
      success: false,
      error: "Content item not found",
      errorCode: "not_found",
      httpStatus: 404,
    };
  }

  if (!SENDABLE_ITEM_STATUSES.has(item.status)) {
    return {
      success: false,
      error: `Cannot send content in "${item.status}" status`,
      errorCode: "invalid_status",
      httpStatus: 400,
    };
  }

  const payload: PublishJobPayload = {
    text: input.text,
    mediaAssetIds: input.mediaAssetIds ?? [],
    platforms: input.platforms,
    title: item.title ?? undefined,
    composedAt: Math.floor(Date.now() / 1000),
  };

  supersedeActiveJobsForContentItem(input.contentItemId);
  const job = createPublishJob({
    contentItemId: input.contentItemId,
    payload,
    platforms: input.platforms,
  });

  updateContentItem(input.contentItemId, { status: "queued" });

  const workspaceSlug = getSignalsRtxWorkspaceSlug(env);
  try {
    await ensureRtxWorkspace(workspaceSlug, "Signals", env, fetchImpl);
    const threadSlug = await createRtxPublishThread(
      workspaceSlug,
      buildPublishThreadName(item.title),
      env,
      fetchImpl
    );

    const message = buildPublishAgentInitialMessage({
      jobId: job.id,
      contentItemId: input.contentItemId,
      title: item.title,
      platforms: input.platforms,
      signalsBaseUrl: resolveSignalsBaseUrl(env),
    });

    const launch = await launchTerminalCliAgent(
      {
        workspaceSlug,
        threadSlug,
        message,
        reason: `Publish content item ${input.contentItemId} to ${input.platforms.join(", ")}`,
      },
      env,
      fetchImpl
    );

    if (!launch.success) {
      markPublishJobLaunchFailed(job.id, launch.error, launch.errorCode);
      updateContentItem(input.contentItemId, { status: "draft" });
      const httpStatus =
        launch.errorCode === "permission_required"
          ? 403
          : launch.errorCode === "standalone"
            ? 400
            : launch.errorCode === "launch_failed"
              ? 502
              : 503;
      return {
        success: false,
        error: launch.error,
        errorCode: launch.errorCode,
        httpStatus,
      };
    }

    const resolvedWorkspace =
      launch.descriptor.linkage?.workspaceSlug ?? workspaceSlug;
    const resolvedThread = launch.descriptor.linkage?.threadSlug ?? threadSlug;

    const updated = updatePublishJobRtxRefs(job.id, {
      rtxWorkspaceSlug: resolvedWorkspace,
      rtxThreadSlug: resolvedThread,
      rtxRuntimeSessionId: launch.descriptor.id,
    });
    if (updated) syncItemStatusFromJob(updated);

    return {
      success: true,
      jobId: job.id,
      rtxWorkspaceSlug: resolvedWorkspace,
      rtxThreadSlug: resolvedThread,
      status: "queued",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    markPublishJobLaunchFailed(job.id, message, "launch_failed");
    updateContentItem(input.contentItemId, { status: "draft" });
    return {
      success: false,
      error: message,
      errorCode: "launch_failed",
      httpStatus: 502,
    };
  }
}
