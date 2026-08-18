import { describe, expect, it, vi } from "vitest";
import { launchTerminalCliAgent, readRtxJsonBody } from "@/lib/rtx/runtime-sessions";

describe("readRtxJsonBody", () => {
  it("parses JSON responses", async () => {
    const response = new Response(JSON.stringify({ success: true }), { status: 200 });
    await expect(readRtxJsonBody(response)).resolves.toEqual({ success: true });
  });

  it("maps plain-text 404 bodies to structured errors", async () => {
    const response = new Response("Not Found", { status: 404 });
    await expect(readRtxJsonBody(response)).resolves.toEqual({
      error: "Not Found",
      code: "RTX_RUNTIME_SESSIONS_UNAVAILABLE",
    });
  });
});

describe("launchTerminalCliAgent", () => {
  it("returns rtx_unavailable when RTX responds with plain-text 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));

    const result = await launchTerminalCliAgent(
      {
        workspaceSlug: "signals",
        threadSlug: "thread-1",
        message: "brief",
        reason: "test",
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl
    );

    expect(result).toEqual({
      success: false,
      error: "Not Found",
      errorCode: "rtx_unavailable",
      httpStatus: 404,
    });
  });
});
