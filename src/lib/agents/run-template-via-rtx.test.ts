import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getLaunchById, upsertLaunch } from "@/lib/db/queries/launches";
import { buildWritingTemplateConfig } from "@/lib/workflows/signals-writing";
import { resetCoreTables } from "@/test/db";

describe("runTemplateViaRtx health preflight", () => {
  let storageDir = "";

  beforeEach(() => {
    resetCoreTables();
    storageDir = mkdtempSync(join(tmpdir(), "signals-writing-run-tests-"));
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("refuses dispatch when Signals health check fails", async () => {
    const template = createTemplate({
      name: "Health Gate",
      templateType: "prospecting",
      status: "active",
      config: "{}",
      isSystem: 1,
    });

    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ status: "error" }),
    })) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        PORT: "3099",
        STORAGE_DIR: storageDir,
      },
      fetchImpl
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("signals_not_running");
      expect(result.httpStatus).toBe(503);
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3099/api/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("records a successful writing dispatch on its launch", async () => {
    const launch = upsertLaunch({
      name: "Launch",
      metadata: { writing: { sources: [], runs: [], preserve: true } },
    });
    const template = createTemplate({
      name: "Platform-native writing",
      templateType: "content",
      status: "active",
      config: JSON.stringify(buildWritingTemplateConfig({ launchId: launch.id })),
      isSystem: 1,
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/cli/get-workspace/signals")) {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
      }
      if (url.endsWith("/cli/create-thread/signals")) {
        return new Response(JSON.stringify({ thread: { slug: "writing-thread" } }), {
          status: 200,
        });
      }
      if (url.endsWith("/cli/send-message/signals/writing-thread")) {
        return new Response(
          JSON.stringify({
            success: true,
            terminalDispatchAccepted: true,
            descriptor: { id: "runtime-writing" },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), {
        status: 500,
      });
    }) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      fetchImpl,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const updated = getLaunchById(launch.id)!;
    expect(updated.status).toBe("generating");
    expect(JSON.parse(updated.metadata ?? "{}")).toMatchObject({
      writing: {
        preserve: true,
        runs: [
          {
            workflowRunId: result.workflowRunId,
            mode: "draft",
            rtxThreadSlug: "writing-thread",
          },
        ],
      },
    });
  });
});
