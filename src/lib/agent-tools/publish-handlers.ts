import { z } from "zod";
import { getContentItem, createContentPost } from "@/lib/db/queries/content";
import { getMediaAsset } from "@/lib/db/queries/media";
import { publishVariantForContentItem } from "@/lib/db/queries/variants";
import {
  applyPublishJobTargets,
  getPublishJobById,
  recordPublishJobTargets,
} from "@/lib/db/queries/publish-jobs";
import { resolveMediaPaths } from "@/lib/browser/publishers/publish-utils";
import { ensureSessionPlatformAccount } from "@/lib/publish/ensure-platform-account";
import { getPlatformAccountById } from "@/lib/db/queries/platform-accounts";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
  resolveDefaultTarget,
  resolveTargetById,
} from "@/lib/db/queries/platform-targets";
import { renewSessionLease } from "@/lib/leases/session-lease";
import {
  defaultTargetCapabilities,
  defaultTargetKind,
  normalizePlatformTargetIdentity,
} from "@/lib/platforms/target-identity";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { buildPlatformPostUrl } from "@/lib/platforms/content-platform";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import { normalizePublishJobKind, resolveSourcePostUrl } from "@/lib/publish/payload";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import type { PublishJobStatus, PublishJobTarget, PublishPlatformTarget } from "@/lib/publish/types";
import type { PublishErrorCode } from "@/lib/browser/publishers/types";
import {
  formatDeferredTerminalTeardownNote,
  scheduleTerminalSessionRelease,
  stopRunningRtxBrowserSessions,
} from "@/lib/rtx/resource-teardown";

export const getPublishJobSchema = z.object({
  jobId: z.string().min(1),
});

export const updatePublishJobSchema = z.object({
  jobId: z.string().min(1),
  platform: z.enum(PUBLISH_PLATFORM_TARGETS).optional(),
  status: z.enum(["publishing", "failed"]),
  note: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  targetId: z.string().min(1).optional(),
  leaseId: z.string().min(1).optional(),
});

export const completePublishSchema = z.object({
  jobId: z.string().min(1),
  platform: z.enum(PUBLISH_PLATFORM_TARGETS),
  targetId: z.string().min(1).optional(),
  leaseId: z.string().min(1).optional(),
  success: z.boolean(),
  handle: z.string().optional(),
  platformPostId: z.string().optional(),
  platformUrl: z.string().optional(),
  error: z.string().optional(),
  errorCode: z
    .enum([
      "session_expired",
      "captcha",
      "upload_failed",
      "timeout",
      "wrong_account",
      "unknown",
    ])
    .optional(),
});

function isTerminalTarget(status: PublishJobTarget["status"]): boolean {
  return status === "published" || status === "failed" || status === "skipped";
}

function isTerminalPublishJob(status: PublishJobStatus): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

function collectPublishBrowserSessionNames(targets: PublishJobTarget[]): string[] {
  const names = new Set<string>([RTX_PUBLISH_SESSION_NAME]);
  for (const target of targets) {
    const sessionName = target.sessionName?.trim();
    if (sessionName) names.add(sessionName);
  }
  return [...names];
}

type CompletePublishInput = z.infer<typeof completePublishSchema>;

function normalizeCompletePublishInput(input: CompletePublishInput): CompletePublishInput {
  if (input.success) return input;
  return {
    ...input,
    error: input.error ?? "Publish failed",
    errorCode: (input.errorCode ?? "unknown") as PublishErrorCode,
  };
}

function targetMatchesResult(
  target: PublishJobTarget,
  input: CompletePublishInput
): boolean {
  const normalized = normalizeCompletePublishInput(input);
  if (target.platform !== normalized.platform) return false;
  if (normalized.targetId && target.targetId !== normalized.targetId) return false;
  if (!normalized.success) {
    return target.error === normalized.error && target.errorCode === normalized.errorCode;
  }
  return (
    target.platformPostId === normalized.platformPostId &&
    target.platformUrl === normalized.platformUrl &&
    target.handle === normalized.handle
  );
}

function persistJobTargets(
  jobId: string,
  targets: PublishJobTarget[],
  recordOnly: boolean
) {
  return recordOnly
    ? recordPublishJobTargets(jobId, targets)
    : applyPublishJobTargets(jobId, targets, { driveItemStatus: true });
}

export async function handleGetPublishJob(input: z.infer<typeof getPublishJobSchema>) {
  const job = getPublishJobById(input.jobId);
  if (!job) {
    return { error: `Publish job not found: ${input.jobId}` };
  }

  const item = getContentItem(job.contentItemId);
  const media = (job.payloadParsed.mediaAssetIds ?? []).map((assetId) => {
    const asset = getMediaAsset(assetId);
    if (!asset) return { assetId, path: null, mimeType: null };
    const paths = resolveMediaPaths([assetId]);
    return {
      assetId,
      path: paths[0] ?? null,
      mimeType: asset.mimeType,
    };
  });

  return {
    jobId: job.id,
    status: job.status,
    stale: job.stale ?? false,
    contentItem: {
      id: job.contentItemId,
      title: item?.title ?? null,
      status: item?.status ?? null,
    },
    payload: {
      kind: normalizePublishJobKind(job.payloadParsed.kind),
      text: job.payloadParsed.text,
      ...(job.payloadParsed.threadTexts?.length
        ? { threadTexts: job.payloadParsed.threadTexts }
        : {}),
      platforms: job.payloadParsed.platforms,
      media,
      ...(job.payloadParsed.sourcePostUrl
        ? { sourcePostUrl: job.payloadParsed.sourcePostUrl }
        : {}),
      ...(job.payloadParsed.sourcePostId
        ? { sourcePostId: job.payloadParsed.sourcePostId }
        : {}),
      ...(resolveSourcePostUrl({
        sourcePostUrl: job.payloadParsed.sourcePostUrl,
        sourcePostId: job.payloadParsed.sourcePostId,
        platform: job.payloadParsed.platforms[0],
      })
        ? {
            resolvedSourcePostUrl: resolveSourcePostUrl({
              sourcePostUrl: job.payloadParsed.sourcePostUrl,
              sourcePostId: job.payloadParsed.sourcePostId,
              platform: job.payloadParsed.platforms[0],
            }),
          }
        : {}),
    },
    targets: job.targetsParsed,
    prepareRequired: true,
    browserSessionName: RTX_PUBLISH_SESSION_NAME,
    rtxWorkspaceSlug: job.rtxWorkspaceSlug,
    rtxThreadSlug: job.rtxThreadSlug,
  };
}

export async function handleUpdatePublishJob(input: z.infer<typeof updatePublishJobSchema>) {
  const job = getPublishJobById(input.jobId);
  if (!job) {
    return { error: `Publish job not found: ${input.jobId}` };
  }

  if (input.leaseId) {
    try {
      renewSessionLease(input.leaseId);
    } catch (error) {
      if (error instanceof PlatformTargetError) {
        return { error: error.message, code: error.code, details: error.details };
      }
      throw error;
    }
  }

  const recordOnly = job.status === "superseded";
  const now = Math.floor(Date.now() / 1000);
  const targets = job.targetsParsed.map((target) => {
    if (input.targetId && target.targetId !== input.targetId) return target;
    if (!input.targetId && input.platform && target.platform !== input.platform) return target;
    if (isTerminalTarget(target.status)) return target;

    if (input.status === "publishing") {
      return {
        ...target,
        status: "publishing" as const,
        startedAt: target.startedAt ?? now,
      };
    }

    return {
      ...target,
      status: "failed" as const,
      error: input.error ?? input.note ?? "Publish skipped",
      errorCode: input.errorCode ?? "unknown",
      completedAt: now,
    };
  });

  const updated = persistJobTargets(job.id, targets, recordOnly);
  return updated
    ? {
        jobId: updated.id,
        status: updated.status,
        targets: updated.targetsParsed,
        ...(recordOnly ? { superseded: true, recorded: true } : {}),
      }
    : { error: "Failed to update publish job" };
}

export async function handleCompletePublish(input: z.infer<typeof completePublishSchema>) {
  const normalized = normalizeCompletePublishInput(input);
  const job = getPublishJobById(normalized.jobId);
  if (!job) {
    return { error: `Publish job not found: ${input.jobId}` };
  }

  const recordOnly = job.status === "superseded";
  let leaseStale = false;
  if (normalized.leaseId) {
    try {
      renewSessionLease(normalized.leaseId);
    } catch {
      leaseStale = true;
    }
  }

  const existingTarget = normalized.targetId
    ? job.targetsParsed.find((target) => target.targetId === normalized.targetId)
    : job.targetsParsed.find((target) => target.platform === normalized.platform);
  if (!existingTarget) {
    return {
      error: normalized.targetId
        ? `Target ${normalized.targetId} is not a target for this job`
        : `Platform ${normalized.platform} is not a target for this job`,
      ...(leaseStale ? { leaseStale: true } : {}),
    };
  }
  if (existingTarget.platform !== normalized.platform) {
    return {
      error: `Target ${existingTarget.targetId ?? normalized.targetId} belongs to ${existingTarget.platform}, not ${normalized.platform}`,
      ...(leaseStale ? { leaseStale: true } : {}),
    };
  }

  if (isTerminalTarget(existingTarget.status)) {
    if (targetMatchesResult(existingTarget, normalized)) {
      return {
        jobId: job.id,
        status: job.status,
        targets: job.targetsParsed,
        idempotent: true,
        ...(recordOnly ? { superseded: true } : {}),
        ...(leaseStale ? { leaseStale: true } : {}),
      };
    }
    return {
      error: `Target for ${normalized.platform} is already terminal with a different result`,
      ...(leaseStale ? { leaseStale: true } : {}),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  let targets: PublishJobTarget[];

  if (normalized.success) {
    if (!normalized.handle?.trim() || !normalized.platformPostId?.trim()) {
      return { error: "handle and platformPostId are required on success" };
    }

    if (!recordOnly) {
      let actingTarget = resolveTargetById(
        normalized.targetId ?? existingTarget.targetId ?? ""
      );
      if (!actingTarget) actingTarget = resolveDefaultTarget(normalized.platform);
      if (!actingTarget) {
        const account = ensureSessionPlatformAccount(
          normalized.platform as PublishPlatformTarget,
          normalized.handle
        );
        const connection = ensureBrowserConnection({
          sessionName: existingTarget.sessionName ?? RTX_PUBLISH_SESSION_NAME,
          kind: "shared",
          source: "complete-publish-fallback",
        });
        const identity = normalizePlatformTargetIdentity(
          normalized.platform,
          normalized.handle
        );
        actingTarget = registerPlatformTarget({
          connectionId: connection.id,
          platform: normalized.platform,
          kind: defaultTargetKind(normalized.platform),
          externalId: identity.externalId,
          name: normalized.handle,
          handle: identity.handle,
          platformAccountId: account.id,
          capabilities: defaultTargetCapabilities(normalized.platform),
          source: "complete-publish-fallback",
        });
      }
      const account =
        (actingTarget.platformAccountId
          ? getPlatformAccountById(actingTarget.platformAccountId)
          : undefined) ??
        ensureSessionPlatformAccount(
          normalized.platform as PublishPlatformTarget,
          normalized.handle
        );

      createContentPost({
        contentItemId: job.contentItemId,
        platformAccountId: account.id,
        targetId: actingTarget.id,
        platformPostId: normalized.platformPostId,
        platformUrl:
          normalized.platformUrl?.trim() ||
          buildPlatformPostUrl(normalized.platform, normalized.platformPostId) ||
          null,
        publishedAt: now,
        status: "published",
      });

      publishVariantForContentItem(job.contentItemId, {
        platform: normalized.platform,
        publishedAt: now,
        targetId: actingTarget.id,
      });
    }

    targets = job.targetsParsed.map((target) =>
      target === existingTarget
        ? {
            ...target,
            status: "published" as const,
            handle: normalized.handle,
            targetId: normalized.targetId ?? target.targetId,
            platformPostId: normalized.platformPostId,
            platformUrl:
              normalized.platformUrl?.trim() ||
              buildPlatformPostUrl(normalized.platform, normalized.platformPostId) ||
              undefined,
            completedAt: now,
          }
        : target
    );
  } else {
    targets = job.targetsParsed.map((target) =>
      target === existingTarget
        ? {
            ...target,
            status: "failed" as const,
            error: normalized.error,
            errorCode: normalized.errorCode as PublishErrorCode,
            completedAt: now,
          }
        : target
    );
  }

  const updated = persistJobTargets(job.id, targets, recordOnly);

  let resourceTeardownNote = "";
  let terminalSessionTeardown:
    | { scheduled: true; sessionId: string }
    | { scheduled: false }
    | undefined;
  let browserSessionTeardown:
    | Awaited<ReturnType<typeof stopRunningRtxBrowserSessions>>
    | undefined;

  if (updated && !recordOnly && isTerminalPublishJob(updated.status as PublishJobStatus)) {
    browserSessionTeardown = await stopRunningRtxBrowserSessions({
      sessionNames: collectPublishBrowserSessionNames(updated.targetsParsed),
      stopAllRunning: true,
    });
    const scheduled = scheduleTerminalSessionRelease(updated.rtxRuntimeSessionId);
    terminalSessionTeardown = scheduled.sessionId
      ? { scheduled: true, sessionId: scheduled.sessionId }
      : { scheduled: false };
    resourceTeardownNote = formatDeferredTerminalTeardownNote({
      terminal: scheduled,
      browser: browserSessionTeardown,
    });
  }

  return updated
    ? {
        jobId: updated.id,
        status: updated.status,
        targets: updated.targetsParsed,
        ...(terminalSessionTeardown ? { terminalSessionTeardown } : {}),
        ...(browserSessionTeardown ? { browserSessionTeardown } : {}),
        ...(resourceTeardownNote ? { message: resourceTeardownNote.trim() } : {}),
        ...(recordOnly ? { superseded: true, recorded: true } : {}),
        ...(leaseStale ? { leaseStale: true } : {}),
      }
    : { error: "Failed to complete publish" };
}
