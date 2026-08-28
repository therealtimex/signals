import { getContentItem, updateContentItem } from "@/lib/db/queries/content";
import { db } from "@/lib/db/client";
import { isPlatform } from "@/lib/db/platforms";
import { getVariantById } from "@/lib/db/queries/variants";
import {
  createPublishJob,
  markPublishJobLaunchFailed,
  supersedeActiveJobsForContentItem,
  syncItemStatusFromJob,
  updatePublishJobRtxRefs,
} from "@/lib/db/queries/publish-jobs";
import type { PublishJobPayload, PublishPlatformTarget } from "@/lib/publish/types";
import type { PublishJobTarget } from "@/lib/publish/types";
import {
  isPublishPlatformTarget,
  validatePublishJobPayload,
} from "@/lib/publish/payload";
import {
  getBrowserConnectionById,
  resolveDefaultTarget,
  resolveTargetById,
} from "@/lib/db/queries/platform-targets";
import {
  buildPublishThreadName,
  createRtxPublishThread,
  ensureRtxWorkspace,
  getSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import { isRtxEmbedded } from "@/lib/rtx/env";
import { resolveSignalsBaseUrlFromEnv } from "@/lib/rtx/resolve-signals-base-url";
import {
  buildPublishAgentInitialMessage,
  dispatchTerminalAgentViaSendMessage,
} from "@/lib/rtx/runtime-sessions";
import {
  buildPublishJobBriefRoutingMessage,
  publishJobBriefRelativePath,
  writeRtxWorkspaceBriefFile,
} from "@/lib/rtx/workspace-brief-files";
import {
  getSurfaceCapabilities,
  publishCapabilityForPlatform,
  type PublishCapability,
} from "@/lib/writing/capabilities";
import { readContentWritingState } from "@/lib/writing/content-writing";
import { surfaceForDraft } from "@/lib/writing/surfaces";
import {
  evaluateWritingPublishGate,
  WRITING_APPROVAL_REQUIRED,
  WRITING_ARTIFACT_STALE,
  type WritingPublishGateResult,
} from "@/lib/writing/publish-gate";

const SENDABLE_ITEM_STATUSES = new Set(["draft", "approved", "failed"]);

export type SendToAgentInput = {
  contentItemId: string;
  platforms: PublishPlatformTarget[];
  targets?: Array<{ targetId: string }>;
  text: string;
  threadTexts?: string[];
  mediaAssetIds?: string[];
  kind?: PublishJobPayload["kind"];
  sourcePostUrl?: string;
  sourcePostId?: string;
  /** Base URL of the running Signals instance (derive from the incoming HTTP request). */
  signalsBaseUrl?: string;
};

export type SendToAgentResult =
  | {
      success: true;
      jobId: string;
      rtxWorkspaceSlug: string;
      rtxThreadSlug: string;
      status: "queued";
      payload: PublishJobPayload;
    }
  | {
      success: false;
      error: string;
      errorCode: string;
      httpStatus: number;
    };

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

  const writingState = readContentWritingState(item);
  if (writingState.kind === "invalid") {
    return gateFailure({
      ok: false,
      code: WRITING_ARTIFACT_STALE,
      reason: "Writing metadata is present but invalid; the artifact cannot be published safely.",
    });
  }
  const writing = writingState.kind === "valid" ? writingState.writing : null;
  if (!writing && !SENDABLE_ITEM_STATUSES.has(item.status)) {
    return {
      success: false,
      error: `Cannot send content in "${item.status}" status`,
      errorCode: "invalid_status",
      httpStatus: 400,
    };
  }

  const writingCapability: PublishCapability | null = writing
    ? writing.surface
      ? getSurfaceCapabilities(writing.surface).publish
      : item.platformTarget && isPlatform(item.platformTarget)
        ? publishCapabilityForPlatform(item.platformTarget)
        : "unsupported"
    : null;
  if (writing && writingCapability !== "direct" && writingCapability !== "beta") {
    return {
      success: false,
      error: `Writing surface cannot be published (${writingCapability ?? "unsupported"})`,
      errorCode: "capability_unsupported",
      httpStatus: 400,
    };
  }
  if (writing) {
    const itemSurface =
      item.platformTarget &&
      isPlatform(item.platformTarget) &&
      (item.contentType === "post" || item.contentType === "thread")
        ? surfaceForDraft(item.platformTarget, item.contentType)
        : null;
    if (!writing.surface || writing.surface !== itemSurface) {
      return {
        success: false,
        error: "Writing surface no longer matches the materialized content target",
        errorCode: "invalid_target",
        httpStatus: 400,
      };
    }
  }
  if (writing && input.kind && input.kind !== "original") {
    return {
      success: false,
      error: "Writing items support original publish jobs only",
      errorCode: "invalid_request",
      httpStatus: 400,
    };
  }

  const preGate = writing
    ? evaluateWritingPublishGate({
        item,
        writing,
        variant: writing.variantId ? (getVariantById(writing.variantId) ?? null) : null,
      })
    : null;
  if (preGate && !preGate.ok) return gateFailure(preGate);

  if (writing) {
    if (!writing.targetId) {
      return gateFailure({
        ok: false,
        code: WRITING_APPROVAL_REQUIRED,
        reason: "The approved writing artifact does not name an acting target.",
      });
    }
    if ((input.targets?.length ?? 0) !== 1) {
      return invalidWritingTarget(
        "Writing items require exactly one explicit acting target matching the approved artifact",
      );
    }
    if (input.targets![0].targetId !== writing.targetId) {
      return invalidWritingTarget("Requested acting target does not match the approved artifact");
    }
  }

  const targetSnapshots: PublishJobTarget[] = [];
  for (const requested of input.targets ?? []) {
    const target = resolveTargetById(requested.targetId);
    if (
      !target ||
      target.status !== "active" ||
      !isPublishPlatformTarget(target.platform)
    ) {
      return {
        success: false,
        error: `Publish target not found or unsupported: ${requested.targetId}`,
        errorCode: "invalid_target",
        httpStatus: 400,
      };
    }
    const connection = getBrowserConnectionById(target.connectionId);
    if (!connection || connection.status !== "active") {
      return {
        success: false,
        error: `Browser connection unavailable for target: ${requested.targetId}`,
        errorCode: "connection_unavailable",
        httpStatus: 409,
      };
    }
    targetSnapshots.push({
      platform: target.platform,
      targetId: target.id,
      expectedHandle: target.handle,
      sessionName: connection.sessionName,
      status: "pending",
    });
  }

  for (const platform of input.platforms) {
    if (targetSnapshots.some((target) => target.platform === platform)) continue;
    const target = resolveDefaultTarget(platform);
    const connection = target ? getBrowserConnectionById(target.connectionId) : undefined;
    targetSnapshots.push({
      platform,
      status: "pending",
      ...(target && connection
        ? {
            targetId: target.id,
            expectedHandle: target.handle,
            sessionName: connection.sessionName,
          }
        : {}),
    });
  }

  const platforms = [...new Set(targetSnapshots.map((target) => target.platform))];
  if (writing) {
    if (
      targetSnapshots.length !== 1 ||
      targetSnapshots[0].targetId !== writing.targetId ||
      platforms.length !== 1 ||
      platforms[0] !== item.platformTarget
    ) {
      return invalidWritingTarget(
        "Writing items require one resolved acting target and platform matching the approved artifact",
      );
    }
  } else {
    for (const platform of platforms) {
      const capability = publishCapabilityForPlatform(platform);
      if (capability !== "direct" && capability !== "beta") {
        return {
          success: false,
          error: `Publish capability is unavailable for ${platform}`,
          errorCode: "capability_unsupported",
          httpStatus: 400,
        };
      }
    }
    if (input.threadTexts !== undefined && item.contentType !== "thread") {
      return {
        success: false,
        error: "threadTexts is only valid for thread content",
        errorCode: "invalid_request",
        httpStatus: 400,
      };
    }
  }
  const writingPayload = preGate?.ok ? preGate.payload : null;
  const payloadResult = validatePublishJobPayload({
    text: writingPayload?.text ?? input.text,
    threadTexts: writingPayload?.threadTexts ?? (writing ? undefined : input.threadTexts),
    mediaAssetIds: input.mediaAssetIds ?? [],
    platforms,
    title: item.title ?? undefined,
    kind: input.kind,
    sourcePostUrl: input.sourcePostUrl,
    sourcePostId: input.sourcePostId,
    composedAt: Math.floor(Date.now() / 1000),
  });
  if (!payloadResult.ok) {
    return {
      success: false,
      error: payloadResult.error,
      errorCode: payloadResult.errorCode,
      httpStatus: 400,
    };
  }
  let payload = payloadResult.payload;

  const transactionResult = db.transaction(() => {
    if (writing) {
      const freshItem = getContentItem(input.contentItemId);
      const freshWritingState = freshItem ? readContentWritingState(freshItem) : null;
      if (!freshItem || !freshWritingState || freshWritingState.kind !== "valid") {
        const unavailableGate: Exclude<WritingPublishGateResult, { ok: true }> = {
          ok: false,
          code:
            freshWritingState?.kind === "invalid"
              ? WRITING_ARTIFACT_STALE
              : WRITING_APPROVAL_REQUIRED,
          reason:
            freshWritingState?.kind === "invalid"
              ? "Writing metadata became invalid before publish-job creation."
              : "Writing materialization is no longer available.",
        };
        return {
          ok: false as const,
          gate: unavailableGate,
        };
      }
      const freshWriting = freshWritingState.writing;
      const gate = evaluateWritingPublishGate({
        item: freshItem,
        writing: freshWriting,
        variant: freshWriting.variantId
          ? (getVariantById(freshWriting.variantId) ?? null)
          : null,
      });
      if (!gate.ok) return { ok: false as const, gate };
      if (
        !freshWriting.targetId ||
        targetSnapshots.length !== 1 ||
        targetSnapshots[0].targetId !== freshWriting.targetId ||
        targetSnapshots[0].platform !== freshItem.platformTarget
      ) {
        const targetGate: Exclude<WritingPublishGateResult, { ok: true }> = {
          ok: false,
          code: WRITING_ARTIFACT_STALE,
          reason: "Approved acting target changed before publish-job creation.",
        };
        return {
          ok: false as const,
          gate: targetGate,
        };
      }
      const freshPayload = validatePublishJobPayload({
        text: gate.payload.text,
        threadTexts: gate.payload.threadTexts,
        mediaAssetIds: input.mediaAssetIds ?? [],
        platforms,
        title: freshItem.title ?? undefined,
        kind: "original",
        composedAt: payload.composedAt,
      });
      if (!freshPayload.ok) {
        throw new Error(freshPayload.error);
      }
      payload = freshPayload.payload;
    }

    supersedeActiveJobsForContentItem(input.contentItemId);
    const job = createPublishJob({
      contentItemId: input.contentItemId,
      payload,
      platforms,
      targets: targetSnapshots,
    });
    updateContentItem(input.contentItemId, { status: "queued" });
    return { ok: true as const, job };
  });
  if (!transactionResult.ok) return gateFailure(transactionResult.gate);
  const job = transactionResult.job;

  try {
    const workspaceSlug = await ensureRtxWorkspace(
      getSignalsRtxWorkspaceSlug(env),
      "Signals",
      env,
      fetchImpl
    );
    const threadSlug = await createRtxPublishThread(
      workspaceSlug,
      buildPublishThreadName(item.title),
      env,
      fetchImpl
    );

    const signalsBaseUrl = input.signalsBaseUrl ?? resolveSignalsBaseUrlFromEnv(env);

    const brief = buildPublishAgentInitialMessage({
      jobId: job.id,
      contentItemId: input.contentItemId,
      title: item.title,
      platforms,
      signalsBaseUrl,
    });

    const briefPath = publishJobBriefRelativePath(job.id);
    const briefWrite = await writeRtxWorkspaceBriefFile(
      workspaceSlug,
      briefPath,
      brief,
      env
    );
    if (!briefWrite.success) {
      throw new Error(briefWrite.error);
    }

    const launch = await dispatchTerminalAgentViaSendMessage(
      {
        workspaceSlug,
        threadSlug,
        message: buildPublishJobBriefRoutingMessage({
          jobId: job.id,
          title: item.title,
          platforms,
          absolutePath: briefWrite.absolutePath,
        }),
        reason: `Publish content item ${input.contentItemId} to ${platforms.join(", ")}`,
      },
      env,
      fetchImpl
    );

    if (!launch.success) {
      markPublishJobLaunchFailed(job.id, launch.error, launch.errorCode);
      updateContentItem(input.contentItemId, { status: writing ? "approved" : "draft" });
      const httpStatus =
        launch.errorCode === "permission_required"
          ? 403
          : launch.errorCode === "standalone"
            ? 400
            : launch.errorCode === "terminal_dispatch_required"
              ? 409
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
      payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Launch failed";
    markPublishJobLaunchFailed(job.id, message, "launch_failed");
    updateContentItem(input.contentItemId, { status: writing ? "approved" : "draft" });
    return {
      success: false,
      error: message,
      errorCode: "launch_failed",
      httpStatus: 502,
    };
  }
}

function gateFailure(gate: Exclude<WritingPublishGateResult, { ok: true }>): SendToAgentResult {
  return {
    success: false,
    error: gate.reason,
    errorCode: gate.code.toLowerCase(),
    httpStatus: 409,
  };
}

function invalidWritingTarget(error: string): SendToAgentResult {
  return {
    success: false,
    error,
    errorCode: "invalid_target",
    httpStatus: 400,
  };
}
