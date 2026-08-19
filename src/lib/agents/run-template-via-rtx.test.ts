import { describe, expect, it, vi } from "vitest";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { resetCoreTables } from "@/test/db";

describe("runTemplateViaRtx health preflight", () => {
  it("refuses dispatch when Signals health check fails", async () => {
    resetCoreTables();
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
});
