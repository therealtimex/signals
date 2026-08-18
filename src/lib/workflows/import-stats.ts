import { getLatestImportRun } from "@/lib/db/queries/workflows";
import type { WorkflowRun } from "@/lib/db/types";

export interface PlatformImportStats {
  status: WorkflowRun["status"];
  added: number;
  updated: number;
  skipped: number;
  lastRunAt: number;
  source: "csv" | "zip" | null;
  fileName: string | null;
}

/**
 * Last-run stats for a platform's Workflows import card, from the latest
 * file-import workflow run. Shared by the LinkedIn and X status routes.
 */
export function getPlatformImportStats(platform: string): PlatformImportStats | null {
  const run = getLatestImportRun(platform);
  if (!run) return null;

  let source: "csv" | "zip" | null = null;
  let fileName: string | null = null;
  try {
    const config = JSON.parse(run.config ?? "{}");
    source = config.source ?? null;
    fileName = config.fileName ?? null;
  } catch {
    // Malformed config — still report counters and timestamp
  }

  let added = 0;
  let updated = 0;
  try {
    const result = JSON.parse(run.result ?? "{}");
    added = result.added ?? 0;
    updated = result.updated ?? 0;
  } catch {
    // Malformed result — fall back to run counters below
  }

  return {
    status: run.status,
    added,
    updated,
    skipped: run.skippedItems,
    lastRunAt: run.completedAt ?? run.createdAt,
    source,
    fileName,
  };
}
