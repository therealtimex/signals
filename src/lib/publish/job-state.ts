import type { PublishJobStatus, PublishJobTarget, PublishTargetStatus } from "@/lib/publish/types";

const TERMINAL_TARGET: PublishTargetStatus[] = ["published", "failed", "skipped"];

export function isTerminalTarget(status: PublishTargetStatus): boolean {
  return TERMINAL_TARGET.includes(status);
}

export function recomputeJobStatus(targets: PublishJobTarget[]): PublishJobStatus {
  if (targets.length === 0) return "failed";

  const allPending = targets.every((t) => t.status === "pending");
  if (allPending) return "queued";

  const anyPublishing = targets.some((t) => t.status === "publishing");
  const anyPending = targets.some((t) => t.status === "pending");
  if (anyPublishing || anyPending) return "publishing";

  const published = targets.filter((t) => t.status === "published").length;
  const failed = targets.filter((t) => t.status === "failed").length;
  const allTerminal = targets.every((t) => isTerminalTarget(t.status));

  if (!allTerminal) return "publishing";
  if (published === 0) return "failed";
  if (failed > 0) return "partial";
  return "completed";
}

export type ItemStatusFromJob = "queued" | "publishing" | "published" | "failed" | null;

/** Map active job status to content_items.status (null = do not change item). */
export function deriveItemStatusFromJob(
  jobStatus: PublishJobStatus,
  targets: PublishJobTarget[]
): ItemStatusFromJob {
  if (jobStatus === "superseded") return null;
  if (jobStatus === "queued") return "queued";
  if (jobStatus === "publishing") return "publishing";
  if (jobStatus === "completed" || jobStatus === "partial") return "published";
  if (jobStatus === "failed") {
    const published = targets.some((t) => t.status === "published");
    return published ? "published" : "failed";
  }
  return null;
}
