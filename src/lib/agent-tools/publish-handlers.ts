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
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import type { PublishJobTarget, PublishPlatformTarget } from "@/lib/publish/types";
import type { PublishErrorCode } from "@/lib/browser/publishers/types";

export const getPublishJobSchema = z.object({
  jobId: z.string().min(1),
});

export const updatePublishJobSchema = z.object({
  jobId: z.string().min(1),
  platform: z.enum(["x", "linkedin"]).optional(),
  status: z.enum(["publishing", "failed"]),
  note: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
});

export const completePublishSchema = z.object({
  jobId: z.string().min(1),
  platform: z.enum(["x", "linkedin"]),
  success: z.boolean(),
  handle: z.string().optional(),
  platformPostId: z.string().optional(),
  platformUrl: z.string().optional(),
  error: z.string().optional(),
  errorCode: z
    .enum(["session_expired", "captcha", "upload_failed", "timeout", "unknown"])
    .optional(),
});

function isTerminalTarget(status: PublishJobTarget["status"]): boolean {
  return status === "published" || status === "failed" || status === "skipped";
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
      text: job.payloadParsed.text,
      platforms: job.payloadParsed.platforms,
      media,
    },
    targets: job.targetsParsed,
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

  const recordOnly = job.status === "superseded";
  const now = Math.floor(Date.now() / 1000);
  const targets = job.targetsParsed.map((target) => {
    if (input.platform && target.platform !== input.platform) return target;
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
  const existingTarget = job.targetsParsed.find((t) => t.platform === normalized.platform);
  if (!existingTarget) {
    return { error: `Platform ${normalized.platform} is not a target for this job` };
  }

  if (isTerminalTarget(existingTarget.status)) {
    if (targetMatchesResult(existingTarget, normalized)) {
      return {
        jobId: job.id,
        status: job.status,
        targets: job.targetsParsed,
        idempotent: true,
        ...(recordOnly ? { superseded: true } : {}),
      };
    }
    return {
      error: `Target for ${normalized.platform} is already terminal with a different result`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  let targets: PublishJobTarget[];

  if (normalized.success) {
    if (!normalized.handle?.trim() || !normalized.platformPostId?.trim()) {
      return { error: "handle and platformPostId are required on success" };
    }

    if (!recordOnly) {
      const account = ensureSessionPlatformAccount(
        normalized.platform as PublishPlatformTarget,
        normalized.handle
      );

      createContentPost({
        contentItemId: job.contentItemId,
        platformAccountId: account.id,
        platformPostId: normalized.platformPostId,
        platformUrl: normalized.platformUrl ?? null,
        publishedAt: now,
        status: "published",
      });

      publishVariantForContentItem(job.contentItemId, {
        platform: normalized.platform,
        publishedAt: now,
      });
    }

    targets = job.targetsParsed.map((target) =>
      target.platform === normalized.platform
        ? {
            ...target,
            status: "published" as const,
            handle: normalized.handle,
            platformPostId: normalized.platformPostId,
            platformUrl: normalized.platformUrl,
            completedAt: now,
          }
        : target
    );
  } else {
    targets = job.targetsParsed.map((target) =>
      target.platform === normalized.platform
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

  return updated
    ? {
        jobId: updated.id,
        status: updated.status,
        targets: updated.targetsParsed,
        ...(recordOnly ? { superseded: true, recorded: true } : {}),
      }
    : { error: "Failed to complete publish" };
}
