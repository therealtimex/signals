// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportDialog, type ImportDialogConfig } from "@/components/import-dialog";
import { IMPORT_RUN_RECORDING_FAILED_MESSAGE } from "@/lib/workflows/import-warning";

// Avoid Radix portal/focus mechanics in happy-dom — the test targets the
// modal's phase logic, not the dialog primitive.
vi.mock("@/components/ui/dialog", async () => {
  const { createElement: h } = await import("react");
  const passthrough =
    (tag: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      h(tag, null, children);
  return {
    Dialog: passthrough("div"),
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogDescription: passthrough("p"),
    DialogFooter: passthrough("div"),
  };
});

const CONFIG: ImportDialogConfig = {
  title: "Import Connections Export",
  description: "Upload a LinkedIn connections CSV or Basic Data Export zip.",
  accept: ".csv,.zip",
  help: "Get a copy of your data on LinkedIn.",
  previewEndpoint: "/api/platforms/linkedin/import/preview",
  importEndpoint: "/api/platforms/linkedin/import",
  reimportNote: "Safe to run again.",
};

function mockImportFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/preview")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          preview: { source: "csv", fileName: "Connections.csv", fileSize: 220, totalRows: 2 },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        result: { added: 2, updated: 0, skipped: 0, errors: [] },
        totalRows: 2,
        source: "csv",
        workflowRunId: "run-123",
      }),
    });
  });
}

async function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="import-dialog-file-input"]'
  )!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ImportDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("runs the pick → preview → import success path", async () => {
    const fetchMock = mockImportFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        createElement(ImportDialog, { config: CONFIG, open: true, onClose, onSuccess })
      );
    });

    // Pick step: drop zone + help visible, no Run button yet
    expect(container.textContent).toContain("Drop your export here or click to browse");
    expect(container.querySelector('[data-testid="import-dialog-run"]')).toBeNull();

    await selectFile(container, new File(["csv-bytes"], "Connections.csv"));

    // Inspection step from the preview response
    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.previewEndpoint,
      expect.objectContaining({ method: "POST" })
    );
    const inspection = container.querySelector('[data-testid="import-dialog-inspection"]');
    expect(inspection?.textContent).toContain("Connections.csv");
    expect(inspection?.textContent).toContain("2");
    expect(container.textContent).toContain("Safe to run again.");
    expect(onSuccess).not.toHaveBeenCalled();

    // Run import
    const runButton = container.querySelector('[data-testid="import-dialog-run"]')!;
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.importEndpoint,
      expect.objectContaining({ method: "POST" })
    );
    expect(onSuccess).toHaveBeenCalledWith({
      added: 2,
      updated: 0,
      skipped: 0,
      source: "csv",
      fileName: "Connections.csv",
      workflowRunId: "run-123",
    });
  });

  it("shows preview errors and stays on the pick step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "No Connections.csv found in zip." }),
      })
    );
    const onSuccess = vi.fn();

    await act(async () => {
      root.render(
        createElement(ImportDialog, { config: CONFIG, open: true, onClose: vi.fn(), onSuccess })
      );
    });

    await selectFile(container, new File(["zip-bytes"], "export.zip"));

    expect(
      container.querySelector('[data-testid="import-dialog-error"]')?.textContent
    ).toContain("No Connections.csv found");
    expect(container.textContent).toContain("Drop your export here or click to browse");
    expect(container.querySelector('[data-testid="import-dialog-run"]')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("passes a structured warning through the success callback", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/preview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            preview: { source: "csv", fileName: "Connections.csv", fileSize: 220, totalRows: 2 },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          result: { added: 2, updated: 0, skipped: 0, errors: [] },
          source: "csv",
          workflowRunId: null,
          warning: {
            code: "IMPORT_RUN_RECORDING_FAILED",
            message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
          },
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();

    await act(async () => {
      root.render(
        createElement(ImportDialog, {
          config: CONFIG,
          open: true,
          onClose: vi.fn(),
          onSuccess,
        })
      );
    });

    await selectFile(container, new File(["csv-bytes"], "Connections.csv"));
    const runButton = container.querySelector('[data-testid="import-dialog-run"]')!;
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({
      warning: {
        code: "IMPORT_RUN_RECORDING_FAILED",
        message: IMPORT_RUN_RECORDING_FAILED_MESSAGE,
      },
    }));
    expect(container.textContent).toContain("Drop your export here or click to browse");
    expect(container.querySelector('[data-testid="import-dialog-run"]')).toBeNull();
  });

  it("keeps the modal open with the error when the import fails", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/preview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            preview: { source: "csv", fileName: "Connections.csv", fileSize: 220, totalRows: 2 },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: "Import failed" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await act(async () => {
      root.render(
        createElement(ImportDialog, {
          config: CONFIG,
          open: true,
          onClose: vi.fn(),
          onSuccess,
          onFailure,
        })
      );
    });

    await selectFile(container, new File(["csv-bytes"], "Connections.csv"));

    const runButton = container.querySelector('[data-testid="import-dialog-run"]')!;
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="import-dialog-error"]')?.textContent
    ).toContain("Import failed");
    expect(container.querySelector('[data-testid="import-dialog-error"]')?.getAttribute("role"))
      .toBe("alert");
    // Retry stays available
    expect(container.querySelector('[data-testid="import-dialog-run"]')).not.toBeNull();
    expect(onFailure).toHaveBeenCalledWith({
      fileName: "Connections.csv",
      source: "csv",
      error: "Import failed",
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("reports network import failures while keeping retry available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/preview")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              preview: {
                source: "csv",
                fileName: "Connections.csv",
                fileSize: 220,
                totalRows: 2,
              },
            }),
          });
        }
        return Promise.reject(new Error("network down"));
      })
    );
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    await act(async () => {
      root.render(
        createElement(ImportDialog, {
          config: CONFIG,
          open: true,
          onClose: vi.fn(),
          onSuccess,
          onFailure,
        })
      );
    });

    await selectFile(container, new File(["csv-bytes"], "Connections.csv"));
    const runButton = container.querySelector('[data-testid="import-dialog-run"]')!;
    await act(async () => {
      runButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onFailure).toHaveBeenCalledWith({
      fileName: "Connections.csv",
      source: "csv",
      error: "Import failed",
    });
    expect(container.querySelector('[data-testid="import-dialog-error"]')?.textContent)
      .toContain("Import failed");
    expect(container.querySelector('[data-testid="import-dialog-run"]')).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
