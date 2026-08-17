import { beforeEach, describe, expect, it } from "vitest";
import { recordImportRun } from "@/lib/workflows/record-import-run";
import { getLatestImportRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";

const NOW = Math.floor(Date.now() / 1000);

describe("recordImportRun", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("records a completed run with counters and result from a successful import", () => {
    const run = recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "zip",
      fileName: "Basic_LinkedInDataExport.zip",
      startedAt: NOW - 5,
      totalRows: 20,
      result: { added: 12, updated: 3, skipped: 5, errors: [] },
    });

    expect(run.workflowType).toBe("import");
    expect(run.status).toBe("completed");
    expect(run.totalItems).toBe(20);
    expect(run.successItems).toBe(15);
    expect(run.skippedItems).toBe(5);
    expect(run.errorItems).toBe(0);
    expect(run.completedAt).toBeGreaterThanOrEqual(NOW);

    const config = JSON.parse(run.config ?? "{}");
    expect(config).toEqual({
      importSubType: "linkedin_connections",
      platform: "linkedin",
      source: "zip",
      fileName: "Basic_LinkedInDataExport.zip",
    });
    expect(JSON.parse(run.result ?? "{}")).toEqual({
      added: 12,
      updated: 3,
      skipped: 5,
      errors: [],
    });

    expect(getWorkflowRun(run.id)?.status).toBe("completed");
  });

  it("marks a run failed when every row errored", () => {
    const run = recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "csv",
      fileName: "Connections.csv",
      startedAt: NOW,
      totalRows: 2,
      result: { added: 0, updated: 0, skipped: 0, errors: ["boom", "boom"] },
    });

    expect(run.status).toBe("failed");
    expect(run.errorItems).toBe(2);
  });

  it("records a failed run when the import throws before producing a result", () => {
    const run = recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "zip",
      fileName: "corrupt.zip",
      startedAt: NOW,
      error: "No Connections.csv found in zip",
    });

    expect(run.status).toBe("failed");
    expect(run.errorItems).toBe(1);
    expect(JSON.parse(run.errors ?? "[]")).toEqual(["No Connections.csv found in zip"]);
  });
});

describe("getLatestImportRun", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns the most recent import run for the platform", () => {
    recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "csv",
      fileName: "old.csv",
      startedAt: NOW - 100,
      result: { added: 1, updated: 0, skipped: 0, errors: [] },
    });
    const latest = recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "zip",
      fileName: "new.zip",
      startedAt: NOW,
      result: { added: 2, updated: 1, skipped: 0, errors: [] },
    });

    const found = getLatestImportRun("linkedin");
    expect(found?.id).toBe(latest.id);
    expect(JSON.parse(found?.config ?? "{}").fileName).toBe("new.zip");
  });

  it("ignores import runs for other platforms", () => {
    recordImportRun({
      platform: "gmail",
      importSubType: "gmail_takeout",
      source: "zip",
      fileName: "takeout.zip",
      startedAt: NOW,
      result: { added: 1, updated: 0, skipped: 0, errors: [] },
    });

    expect(getLatestImportRun("linkedin")).toBeUndefined();
  });

  it("includes failed runs so the card can surface them", () => {
    const failed = recordImportRun({
      platform: "linkedin",
      importSubType: "linkedin_connections",
      source: "csv",
      fileName: "bad.csv",
      startedAt: NOW,
      error: "No valid rows",
    });

    expect(getLatestImportRun("linkedin")?.id).toBe(failed.id);
  });
});
