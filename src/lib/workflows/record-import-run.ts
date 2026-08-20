import { createWorkflowRun } from "@/lib/db/queries/workflows";
import type { SyncResult } from "@/lib/platforms/adapter";
import type { WorkflowRun } from "@/lib/db/types";

export type ImportSource = "csv" | "zip" | "vcf";

/** Config JSON persisted on import workflow runs. */
export interface ImportRunConfig {
  importSubType: string;
  platform: string;
  source: ImportSource;
  fileName: string | null;
}

interface RecordImportRunOpts {
  id?: string;
  platform: string;
  importSubType: string;
  source: ImportSource;
  fileName: string | null;
  startedAt: number;
  totalRows?: number;
  /** Present on successful imports (may still carry row-level errors). */
  result?: SyncResult;
  /** Present when the import failed before producing a result. */
  error?: string;
}

/**
 * Persist a file import (e.g. LinkedIn Connections export upload) as a
 * workflow run so it shows up in Automation → Runs and drives last-run
 * stats on the Workflows import card.
 *
 * File imports are synchronous, so the run is recorded once at the end
 * with its final status instead of being updated in place.
 */
export function recordImportRun(opts: RecordImportRunOpts): WorkflowRun {
  const completedAt = Math.floor(Date.now() / 1000);
  const config: ImportRunConfig = {
    importSubType: opts.importSubType,
    platform: opts.platform,
    source: opts.source,
    fileName: opts.fileName,
  };

  if (opts.result) {
    const successItems = opts.result.added + opts.result.updated;
    const processedItems = successItems + opts.result.skipped;
    const status =
      opts.result.errors.length > 0 && successItems === 0 ? "failed" : "completed";

    return createWorkflowRun({
      id: opts.id,
      workflowType: "import",
      status,
      totalItems: opts.totalRows ?? processedItems,
      processedItems,
      successItems,
      skippedItems: opts.result.skipped,
      errorItems: opts.result.errors.length,
      config: JSON.stringify(config),
      result: JSON.stringify(opts.result),
      errors: JSON.stringify(opts.result.errors),
      startedAt: opts.startedAt,
      completedAt,
    });
  }

  return createWorkflowRun({
    id: opts.id,
    workflowType: "import",
    status: "failed",
    totalItems: opts.totalRows ?? null,
    errorItems: 1,
    config: JSON.stringify(config),
    errors: JSON.stringify([opts.error ?? "Import failed"]),
    startedAt: opts.startedAt,
    completedAt,
  });
}
