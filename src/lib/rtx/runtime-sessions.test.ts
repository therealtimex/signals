import { describe, expect, it, vi } from "vitest";
import {
  appendRtxThreadMessage,
  dispatchTerminalAgentViaSendMessage,
  isTerminalRuntimeSessionBusy,
  launchTerminalCliAgent,
  readRtxJsonBody,
  terminateTerminalRuntimeSession,
  waitForTerminalSessionIdle,
} from "@/lib/rtx/runtime-sessions";

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
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            workspace: {
              workspace_configs: {
                defaultAgent: {
                  id: "terminal-antigravity",
                  name: "antigravity",
                  terminal: { providerId: "antigravity-cli", modelId: "gemini-3.7-flash-high" },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/launch-terminal-cli-agent")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.endsWith("/cli/open-terminal-session") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.agentName).toBe("antigravity");
        expect(body.providerId).toBe("antigravity-cli");
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns rtx_unavailable when both SDK and CLI launch fail", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ workspace: { workspace_configs: {} } }), {
          status: 200,
        });
      }
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("requires a configured workspace default when requested", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ workspace: { workspace_configs: {} } }), {
          status: 200,
        });
      }
      return new Response("should not launch", { status: 500 });
    });

    const result = await launchTerminalCliAgent(
      {
        workspaceSlug: "signals",
        threadSlug: "thread-1",
        message: "brief",
        reason: "test",
        requireWorkspaceDefaultAgent: true,
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: false,
      error:
        "No terminal agent is configured for this workspace. Set a workspace default terminal agent in RealTimeX.",
      errorCode: "terminal_dispatch_required",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchTerminalAgentViaSendMessage", () => {
  it("dispatches via /cli/send-message without resolving workspace default agent", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/cli/send-message/signals/thread-1") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.message).toContain("workflow-runs/run-1/brief.md");
        expect(body.requireTerminalDispatch).toBe(true);
        return new Response(
          JSON.stringify({
            success: true,
            terminalDispatchAccepted: true,
            descriptor: { id: "cli-agent:dispatch-1" },
            workspaceSlug: "signals",
            threadSlug: "thread-1",
          }),
          { status: 200 }
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await dispatchTerminalAgentViaSendMessage(
      {
        workspaceSlug: "signals",
        threadSlug: "thread-1",
        message:
          "Execute the Signals workflow brief at `workflow-runs/run-1/brief.md`. Report a concise summary in this thread when finished.",
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
        id: "cli-agent:dispatch-1",
        linkage: { workspaceSlug: "signals", threadSlug: "thread-1" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps TERMINAL_DISPATCH_REQUIRED to terminal_dispatch_required", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          terminalDispatchAccepted: false,
          code: "TERMINAL_DISPATCH_REQUIRED",
          error: "No terminal agent configured",
        }),
        { status: 409 }
      )
    );

    const result = await dispatchTerminalAgentViaSendMessage(
      {
        workspaceSlug: "signals",
        threadSlug: "thread-1",
        message: "Run brief",
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl
    );

    expect(result).toEqual({
      success: false,
      error: "No terminal agent configured",
      errorCode: "terminal_dispatch_required",
      httpStatus: 409,
    });
  });
});

describe("appendRtxThreadMessage", () => {
  it("posts a message without terminal dispatch", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/cli/send-message/signals/thread-1");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.message).toBe("Pipeline kickoff");
      expect(body.requireTerminalDispatch).toBe(false);
      expect(body.skipTerminalDispatch).toBe(true);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const result = await appendRtxThreadMessage(
      {
        workspaceSlug: "signals",
        threadSlug: "thread-1",
        message: "Pipeline kickoff",
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl as typeof fetch,
    );

    expect(result).toEqual({ success: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("terminateTerminalRuntimeSession", () => {
  it("skips when no session id is stored", async () => {
    const fetchImpl = vi.fn();
    await expect(
      terminateTerminalRuntimeSession(null, { RTX_APP_ID: "app-1" }, fetchImpl)
    ).resolves.toEqual({ success: true, terminated: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the RTX terminate endpoint for a stored session id", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe(
        "http://127.0.0.1:3001/cli/terminate-terminal-session/cli-agent%3Asession-1"
      );
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    await expect(
      terminateTerminalRuntimeSession(
        "cli-agent:session-1",
        {
          RTX_APP_ID: "app-1",
          RTX_API_BASE_URL: "http://127.0.0.1:3001",
        },
        fetchImpl
      )
    ).resolves.toEqual({ success: true, terminated: true });
  });
});

describe("terminal session idle helpers", () => {
  it("treats capturing chat-linked turns as busy", () => {
    expect(
      isTerminalRuntimeSessionBusy({
        id: "cli-agent:session-1",
        chatLinkedTurnStateKnown: true,
        chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
      })
    ).toBe(true);
    expect(
      isTerminalRuntimeSessionBusy({
        id: "cli-agent:session-1",
        chatLinkedTurnStateKnown: true,
        chatLinkedPendingTurn: null,
      })
    ).toBe(false);
  });

  it("waits until the chat-linked turn clears before reporting idle", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            results: {
              workspaces: [
                {
                  threads: [
                    {
                      sessions: [
                        {
                          id: "cli-agent:session-1",
                          chatLinkedTurnStateKnown: true,
                          chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            results: {
              workspaces: [
                {
                  threads: [
                    {
                      sessions: [
                        {
                          id: "cli-agent:session-1",
                          chatLinkedTurnStateKnown: true,
                          chatLinkedPendingTurn: null,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        )
      );

    const idlePromise = waitForTerminalSessionIdle("cli-agent:session-1", {
      retryDelaysMs: [10],
      env: { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl: fetchImpl as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(idlePromise).resolves.toEqual({ idle: true });
    vi.useRealTimers();
  });
});
