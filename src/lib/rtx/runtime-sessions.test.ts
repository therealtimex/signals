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
  it("falls back to /cli/open-terminal-session when the SDK route returns plain-text 404", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/sdk/desktop/runtime-sessions/launch-terminal-cli-agent")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/cli/open-terminal-session") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            session: {
              id: "cli-agent:test",
              workspaceSlug: "signals",
              threadSlug: "thread-1",
            },
          }),
          { status: 200 }
        );
      }
      return new Response("unexpected", { status: 500 });
    });

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
      success: true,
      descriptor: {
        id: "cli-agent:test",
        linkage: { workspaceSlug: "signals", threadSlug: "thread-1" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns rtx_unavailable when both SDK and CLI launch fail", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (
        url.endsWith("/sdk/desktop/runtime-sessions/launch-terminal-cli-agent") ||
        url.endsWith("/cli/open-terminal-session")
      ) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response("unexpected", { status: 500 });
    });

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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
