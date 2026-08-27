import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { contacts, workflowRuns } from "@/lib/db/schema";
import { importLinkedInCsv } from "@/lib/platforms/linkedin/csv-import";
import { recordImportRun } from "@/lib/workflows/record-import-run";
import { IMPORT_RUN_RECORDING_FAILED_MESSAGE } from "@/lib/workflows/import-warning";
import { resetCoreTables } from "@/test/db";
import { POST } from "@/app/api/platforms/linkedin/import/route";

vi.mock("@/lib/platforms/linkedin/csv-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platforms/linkedin/csv-import")>();
  return { ...actual, importLinkedInCsv: vi.fn(actual.importLinkedInCsv) };
});

vi.mock("@/lib/workflows/record-import-run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workflows/record-import-run")>();
  return { ...actual, recordImportRun: vi.fn(actual.recordImportRun) };
});

const CONNECTIONS_CSV = [
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Ada,Lovelace,https://www.linkedin.com/in/ada-lovelace,ada@example.com,Analytical Engines,Founder,27 Aug 2026",
  "Grace,Hopper,https://www.linkedin.com/in/grace-hopper,grace@example.com,Compilers Inc,Admiral,27 Aug 2026",
].join("\n");

function importRequest(): NextRequest {
  const formData = new FormData();
  formData.append("file", new File([CONNECTIONS_CSV], "Connections.csv", { type: "text/csv" }));
  return new NextRequest("http://localhost/api/platforms/linkedin/import", {
    method: "POST",
    body: formData,
  });
}

function rowCount(table: typeof contacts | typeof workflowRuns): number {
  return db.select({ value: count() }).from(table).get()?.value ?? 0;
}

describe("POST /api/platforms/linkedin/import", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetCoreTables();
    vi.mocked(importLinkedInCsv).mockClear();
    vi.mocked(recordImportRun).mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("keeps the full-success response unchanged and records the run", async () => {
    const response = await POST(importRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      result: { added: 2, updated: 0, skipped: 0, errors: [] },
      totalRows: 2,
      source: "csv",
      workflowRunId: expect.any(String),
    });
    expect("warning" in body).toBe(false);
    expect(rowCount(workflowRuns)).toBe(1);
    expect(rowCount(contacts)).toBe(2);
  });

  it("returns the original data-write failure and records a failed run", async () => {
    vi.mocked(importLinkedInCsv).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const response = await POST(importRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "boom" });
    expect("success" in body).toBe(false);
    expect(recordImportRun).toHaveBeenCalledWith(expect.objectContaining({ error: "boom" }));
  });

  it("returns a safe partial-success warning when run recording fails", async () => {
    vi.mocked(recordImportRun).mockImplementationOnce(() => {
      throw new Error("secret sqlite failure");
    });

    const response = await POST(importRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      result: { added: 2 },
      workflowRunId: null,
      warning: {
        code: "IMPORT_RUN_RECORDING_FAILED",
        message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
      },
    });
    expect(body.warning.message).not.toContain("secret sqlite failure");
    expect(rowCount(contacts)).toBe(2);
    expect(rowCount(workflowRuns)).toBe(0);
    expect(consoleError).toHaveBeenCalledWith(
      "[linkedin import] failed to record import run",
      expect.any(Error)
    );
  });

  it("does not let failed-run recording mask the original import failure", async () => {
    vi.mocked(importLinkedInCsv).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    vi.mocked(recordImportRun).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const response = await POST(importRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
    expect(consoleError).toHaveBeenCalledWith(
      "[linkedin import] failed to record failed run",
      expect.any(Error)
    );
  });
});
