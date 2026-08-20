export type ContentRowActionKind =
  | "edit"
  | "retry"
  | "open-thread"
  | "open-platform"
  | "mark-failed";

interface ContentRowActionOptions {
  status: string;
  hasRetryPayload: boolean;
  hasThread: boolean;
  hasPlatformUrl: boolean;
  stale: boolean;
  hasJob: boolean;
}

export function getContentRowActionKinds({
  status,
  hasRetryPayload,
  hasThread,
  hasPlatformUrl,
  stale,
  hasJob,
}: ContentRowActionOptions): ContentRowActionKind[] {
  const actions: ContentRowActionKind[] = [];

  if (status === "draft") actions.push("edit");
  if (status === "failed" && hasRetryPayload) actions.push("retry");
  if (hasThread) actions.push("open-thread");
  if (hasPlatformUrl) actions.push("open-platform");
  if ((status === "failed" || stale) && hasJob) actions.push("mark-failed");

  return actions;
}

export function getOpenPlatformLabel(platform: string | null): string {
  return platform ? `Open on ${platform}` : "Open on platform";
}
