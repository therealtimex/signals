import { describe, expect, it } from "vitest";
import {
  actionNeedsPlatformConnection,
  getImportCardNote,
  getImportToast,
  getActionRunButtonLabel,
  importStatsFromFailure,
  importStatsFromSuccess,
} from "@/app/dashboard/workflows/action-cards-utils";
import {
  IMPORT_OUTCOME_UNKNOWN_MESSAGE,
  type ImportSuccess,
} from "@/components/import-dialog";
import { IMPORT_RUN_RECORDING_FAILED_MESSAGE } from "@/lib/workflows/import-warning";

const IMPORT_SUCCESS: ImportSuccess = {
  added: 2,
  updated: 1,
  skipped: 3,
  source: "csv",
  fileName: "Connections.csv",
  workflowRunId: "run-123",
};

describe("action-cards utils", () => {
  it("does not require X connection for RTX enrich actions when disconnected", () => {
    expect(
      actionNeedsPlatformConnection("x-enrich", "api", false, false)
    ).toBe(false);
    expect(
      actionNeedsPlatformConnection("x-enrich-low", "api", false, false)
    ).toBe(false);
  });

  it("still requires connection for other X sync actions when disconnected", () => {
    expect(
      actionNeedsPlatformConnection("x-sync-posts", "api", false, false)
    ).toBe(true);
    expect(
      actionNeedsPlatformConnection("x-sync-posts", "api", true, false)
    ).toBe(false);
  });

  it("shows RTX steps label for enrich actions without a connection gate", () => {
    expect(
      getActionRunButtonLabel("x-enrich", {
        needsConnection: false,
        hasRestriction: false,
        isRunning: false,
      })
    ).toBe("Show RTX steps");
    expect(
      getActionRunButtonLabel("x-sync-posts", {
        needsConnection: true,
        hasRestriction: false,
        isRunning: false,
      })
    ).toBe("Connect first");
  });

  it("does not require connection for upload actions", () => {
    expect(
      actionNeedsPlatformConnection("li-import-csv", "upload", false, false)
    ).toBe(false);
  });

  it("labels upload cards with the modal entry point", () => {
    expect(
      getActionRunButtonLabel("li-import-csv", {
        needsConnection: false,
        hasRestriction: false,
        isRunning: false,
        isUpload: true,
      })
    ).toBe("Import…");
  });

  it("maps full and partial successes into local import stats", () => {
    expect(importStatsFromSuccess(IMPORT_SUCCESS, 123)).toEqual({
      status: "completed",
      added: 2,
      updated: 1,
      skipped: 3,
      lastRunAt: 123,
      source: "csv",
      fileName: "Connections.csv",
      warning: null,
    });

    expect(
      importStatsFromSuccess(
        {
          ...IMPORT_SUCCESS,
          workflowRunId: null,
          warning: {
            code: "IMPORT_RUN_RECORDING_FAILED",
            message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
          },
        },
        456
      )
    ).toEqual(expect.objectContaining({
      lastRunAt: 456,
      warning: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
    }));
  });

  it("maps an import failure into only the affected card's local stats", () => {
    expect(importStatsFromFailure(
      {
        status: "failed",
        fileName: "Connections.csv",
        source: "csv",
        error: "Import failed",
      },
      123
    )).toEqual({
      status: "failed",
      added: 0,
      updated: 0,
      skipped: 0,
      lastRunAt: 123,
      source: "csv",
      fileName: "Connections.csv",
      error: "Import failed",
    });
  });

  it("suppresses the retry note for partial success and unknown outcomes", () => {
    const baseStats = importStatsFromSuccess(IMPORT_SUCCESS, 123);
    const unknownStats = importStatsFromFailure(
      {
        status: "unknown",
        fileName: "Connections.csv",
        source: "csv",
        error: IMPORT_OUTCOME_UNKNOWN_MESSAGE,
      },
      456
    );

    expect(
      getImportCardNote(
        { ...baseStats, warning: IMPORT_RUN_RECORDING_FAILED_MESSAGE },
        "Safe to run again."
      )
    ).toEqual({ kind: "warning", text: IMPORT_RUN_RECORDING_FAILED_MESSAGE });
    expect(
      getImportCardNote(
        { ...baseStats, status: "failed", error: "Import failed" },
        "Safe to run again."
      )
    ).toEqual({ kind: "error", text: "Import failed", note: "Safe to run again." });
    expect(unknownStats.status).toBe("unknown");
    expect(getImportCardNote(unknownStats, "Safe to run again.")).toEqual({
      kind: "unknown",
      text: IMPORT_OUTCOME_UNKNOWN_MESSAGE,
    });
    expect(getImportCardNote(baseStats, "Safe to run again.")).toEqual({
      kind: "note",
      text: "Safe to run again.",
    });
  });

  it("routes partial success to Contacts and full success to its run", () => {
    expect(getImportToast({
      ...IMPORT_SUCCESS,
      workflowRunId: null,
      warning: {
        code: "IMPORT_RUN_RECORDING_FAILED",
        message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
      },
    })).toEqual({
      message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
      actionLabel: "Open Contacts",
      target: "/dashboard/contacts",
      tone: "warning",
    });
    expect(getImportToast(IMPORT_SUCCESS)).toEqual({
      message: "Imported Connections.csv: 2 added, 1 updated, 3 skipped",
      actionLabel: "View in Runs",
      target: "/dashboard/workflows/run-123",
      tone: "success",
    });
  });
});
