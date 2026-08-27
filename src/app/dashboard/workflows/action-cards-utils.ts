import type { ImportFailure, ImportSuccess } from "@/components/import-dialog";

/** X enrich cards show RTX migration steps even when Signals X OAuth is disconnected. */
export const ENRICH_ACTION_IDS = new Set(["x-enrich", "x-enrich-low"]);

/** Client-local last-run state for a file import card. */
export type ImportStats = {
  status: string;
  added: number;
  updated: number;
  skipped: number;
  lastRunAt: number;
  source: "csv" | "zip" | null;
  fileName: string | null;
  warning?: string | null;
  error?: string | null;
};

export function importStatsFromSuccess(result: ImportSuccess, now: number): ImportStats {
  return {
    status: "completed",
    added: result.added,
    updated: result.updated,
    skipped: result.skipped,
    lastRunAt: now,
    source: result.source,
    fileName: result.fileName,
    warning: result.warning?.message ?? null,
  };
}

export function importStatsFromFailure(result: ImportFailure, now: number): ImportStats {
  return {
    status: result.status,
    added: 0,
    updated: 0,
    skipped: 0,
    lastRunAt: now,
    source: result.source,
    fileName: result.fileName,
    error: result.error,
  };
}

export function getImportCardNote(
  stats: ImportStats,
  reimportNote: string
):
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string; note: string }
  | { kind: "unknown"; text: string }
  | { kind: "note"; text: string } {
  if (stats.warning) {
    return { kind: "warning", text: stats.warning };
  }
  if (stats.status === "failed" && stats.error) {
    return { kind: "error", text: stats.error, note: reimportNote };
  }
  if (stats.status === "unknown" && stats.error) {
    return { kind: "unknown", text: stats.error };
  }
  return { kind: "note", text: reimportNote };
}

export function getImportToast(result: ImportSuccess): {
  message: string;
  actionLabel: "View in Runs" | "Open Contacts";
  target: string;
  tone: "success" | "warning";
} {
  if (result.warning) {
    return {
      message: result.warning.message,
      actionLabel: "Open Contacts",
      target: "/dashboard/contacts",
      tone: "warning",
    };
  }
  return {
    message: `Imported ${result.fileName}: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`,
    actionLabel: "View in Runs",
    target: result.workflowRunId
      ? `/dashboard/workflows/${result.workflowRunId}`
      : "/dashboard/workflows?tab=runs",
    tone: "success",
  };
}

export function actionNeedsPlatformConnection(
  actionId: string,
  actionType: "api" | "upload",
  isConnected: boolean,
  isLoading: boolean
): boolean {
  if (actionType === "upload") return false;
  if (ENRICH_ACTION_IDS.has(actionId)) return false;
  return !isConnected && !isLoading;
}

export function getActionRunButtonLabel(
  actionId: string,
  opts: {
    needsConnection: boolean;
    restrictionNavigateTo?: string;
    hasRestriction: boolean;
    isRunning: boolean;
    isUpload?: boolean;
  }
): string {
  if (opts.needsConnection) return "Connect first";
  if (opts.restrictionNavigateTo) return "Go to Settings";
  if (opts.hasRestriction) return "Restricted";
  if (opts.isRunning) return "Running...";
  if (ENRICH_ACTION_IDS.has(actionId)) return "Show RTX steps";
  if (opts.isUpload) return "Import…";
  return "Run";
}
