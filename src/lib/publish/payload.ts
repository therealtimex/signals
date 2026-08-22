import type { PublishJobPayload, PublishJobKind, PublishPlatformTarget } from "@/lib/publish/types";

export const PUBLISH_JOB_KINDS = ["original", "repost", "quote"] as const;

export const PUBLISH_PLATFORM_TARGETS = ["x", "linkedin", "facebook"] as const;

export function normalizePublishJobKind(value: unknown): PublishJobKind {
  if (value === "repost" || value === "quote") return value;
  return "original";
}

export function isPublishPlatformTarget(value: string): value is PublishPlatformTarget {
  return (PUBLISH_PLATFORM_TARGETS as readonly string[]).includes(value);
}

export function resolveSourcePostUrl(input: {
  sourcePostUrl?: string | null;
  sourcePostId?: string | null;
  platform?: PublishPlatformTarget;
}): string | null {
  const url = input.sourcePostUrl?.trim();
  if (url) return url;

  const postId = input.sourcePostId?.trim();
  if (!postId) return null;

  switch (input.platform) {
    case "x":
      return `https://x.com/i/status/${postId}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;
    case "facebook":
      return postId.startsWith("http") ? postId : `https://www.facebook.com/${postId}`;
    default:
      return null;
  }
}

export type PublishPayloadValidationResult =
  | { ok: true; payload: PublishJobPayload }
  | { ok: false; error: string; errorCode: string };

export function validatePublishJobPayload(input: {
  text?: string;
  mediaAssetIds?: string[];
  platforms: PublishPlatformTarget[];
  title?: string;
  kind?: PublishJobKind;
  sourcePostUrl?: string;
  sourcePostId?: string;
  composedAt?: number;
}): PublishPayloadValidationResult {
  const kind = normalizePublishJobKind(input.kind);
  const text = input.text ?? "";
  const mediaAssetIds = input.mediaAssetIds ?? [];
  const platforms = [...new Set(input.platforms)];

  if (platforms.length === 0) {
    return { ok: false, error: "At least one publish platform is required", errorCode: "invalid_request" };
  }

  if (!platforms.every(isPublishPlatformTarget)) {
    return { ok: false, error: "Unsupported publish platform", errorCode: "invalid_target" };
  }

  if (kind === "original") {
    if (!text.trim()) {
      return { ok: false, error: "text is required for original publish jobs", errorCode: "invalid_request" };
    }
  } else {
    const sourceUrl = resolveSourcePostUrl({
      sourcePostUrl: input.sourcePostUrl,
      sourcePostId: input.sourcePostId,
      platform: platforms[0],
    });
    if (!sourceUrl) {
      return {
        ok: false,
        error: "sourcePostUrl or sourcePostId is required for repost/quote jobs",
        errorCode: "invalid_request",
      };
    }
    if (kind === "quote" && !text.trim()) {
      return {
        ok: false,
        error: "text is required for quote-post jobs",
        errorCode: "invalid_request",
      };
    }
    if (platforms.length !== 1 || platforms[0] !== "x") {
      return {
        ok: false,
        error: "Repost and quote jobs are supported on X only in v1",
        errorCode: "invalid_request",
      };
    }
  }

  const payload: PublishJobPayload = {
    kind,
    text,
    mediaAssetIds,
    platforms,
    composedAt: input.composedAt ?? Math.floor(Date.now() / 1000),
    ...(input.title ? { title: input.title } : {}),
    ...(input.sourcePostUrl?.trim() ? { sourcePostUrl: input.sourcePostUrl.trim() } : {}),
    ...(input.sourcePostId?.trim() ? { sourcePostId: input.sourcePostId.trim() } : {}),
  };

  return { ok: true, payload };
}
