export type PublishPlatformTarget = "x" | "linkedin";

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
  text: string;
  mediaAssetIds: string[];
  platforms: PublishPlatformTarget[];
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
