export type PublishPlatformTarget = "x" | "linkedin" | "facebook";

export type PublishJobKind = "original" | "repost" | "quote";

export type PublishJobStatus =
  | "queued"
  | "publishing"
  | "completed"
  | "partial"
  | "failed"
  | "superseded";

export type PublishTargetStatus =
  | "pending"
  | "publishing"
  | "published"
  | "failed"
  | "skipped";

export interface PublishJobPayload {
  /** Defaults to "original" when omitted (legacy jobs). */
  kind?: PublishJobKind;
  text: string;
  mediaAssetIds: string[];
  platforms: PublishPlatformTarget[];
  /** Required for repost/quote jobs when sourcePostId is absent. */
  sourcePostUrl?: string;
  /** Platform-native post id; resolved to a URL per platform when sourcePostUrl is absent. */
  sourcePostId?: string;
  title?: string;
  composedAt: number;
}

export interface PublishJobTarget {
  platform: PublishPlatformTarget;
  targetId?: string;
  expectedHandle?: string | null;
  sessionName?: string;
  status: PublishTargetStatus;
  platformPostId?: string;
  platformUrl?: string;
  handle?: string;
  error?: string;
  errorCode?: string;
  startedAt?: number;
  completedAt?: number;
}

export type PublishLaunchErrorCode =
  | "standalone"
  | "permission_required"
  | "rtx_unavailable"
  | "launch_failed"
  | "terminal_dispatch_required";

export const PUBLISH_JOB_STALE_MS = 30 * 60 * 1000;
