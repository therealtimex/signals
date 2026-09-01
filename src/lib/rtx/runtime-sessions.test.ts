import { describe, expect, it, vi } from "vitest";
import {
  appendRtxThreadMessage,
  dispatchTerminalAgentViaSendMessage,
  isTerminalRuntimeSessionBusy,
  launchTerminalCliAgent,
  listTerminalRuntimeSessions,
  readRtxJsonBody,
  resolveActiveTerminalSessionIdForThread,
  terminateTerminalRuntimeSession,
  waitForTerminalSessionIdle,
} from "@/lib/rtx/runtime-sessions";
import liveTerminalSessionsPayload from "./host-fixtures/list-terminal-sessions.live.json";

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
        expect(body.interactionMode).toBe("chat-linked");
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

  it("uses terminal-first launch to avoid reusing a matching live chat-linked session", async () => {
    const matchingLiveSessionId = "cli-agent:live-chat-linked";
    const launchBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            workspace: {
              workspace_configs: {
                defaultAgent: {
                  id: "terminal-codex",
                  name: "codex",
                  terminal: { providerId: "codex-cli", modelId: "gpt-5.6-sol" },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/launch-terminal-cli-agent")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        launchBodies.push(body);
        // Mirror the desktop host boundary: chat-linked requests reuse a live
        // same-thread session; terminal-first requests physically launch.
        const sessionId =
          body.interactionMode === "chat-linked"
            ? matchingLiveSessionId
            : "cli-agent:fresh-persona";
        return new Response(
          JSON.stringify({ success: true, descriptor: { id: sessionId } }),
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const result = await launchTerminalCliAgent(
      {
        workspaceSlug: "signals",
        threadSlug: "persona-generation",
        message: "Run persona brief",
        reason: "test fresh persona session",
        requireWorkspaceDefaultAgent: true,
        interactionMode: "terminal-first",
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: true,
      descriptor: { id: "cli-agent:fresh-persona" },
    });
    expect(result.success && result.descriptor.id).not.toBe(matchingLiveSessionId);
    expect(launchBodies).toEqual([
      expect.objectContaining({
        workspaceSlug: "signals",
        threadSlug: "persona-generation",
        interactionMode: "terminal-first",
        primarySurface: "terminal",
      }),
    ]);
  });

  it("preserves a 503 default-agent lookup failure instead of reporting missing configuration", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Workspace lookup temporarily unavailable" }), {
        status: 503,
      }),
    );

    const result = await launchTerminalCliAgent(
      {
        workspaceSlug: "signals",
        threadSlug: "persona-generation",
        message: "Run persona brief",
        reason: "test lookup failure",
        requireWorkspaceDefaultAgent: true,
        interactionMode: "terminal-first",
      },
      {
        RTX_APP_ID: "app-1",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl,
    );

    expect(result).toEqual({
      success: false,
      error: "Workspace lookup temporarily unavailable",
      errorCode: "rtx_unavailable",
      httpStatus: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves a network default-agent lookup failure instead of reporting missing configuration", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await launchTerminalCliAgent(
      {
        workspaceSlug: "signals",
        threadSlug: "persona-generation",
        message: "Run persona brief",
        reason: "test lookup failure",
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
      error: "fetch failed",
      errorCode: "rtx_unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchTerminalAgentViaSendMessage", () => {
  it("dispatches through PromptInput without resolving workspace default agent", async () => {
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
        expect(body.channelTurnId).toBe("run-1");
        expect(body).not.toHaveProperty("terminalSessionPolicy");
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
        channelTurnId: "run-1",
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
      expect(JSON.parse(String(init?.body))).toEqual({
        reason: "idle_timeout_resumable",
      });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    await expect(
      terminateTerminalRuntimeSession(
        "cli-agent:session-1",
        {
          RTX_APP_ID: "app-1",
          RTX_API_BASE_URL: "http://127.0.0.1:3001",
        },
        fetchImpl,
        { reason: "idle_timeout_resumable" }
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
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
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

/**
 * These run against `list-terminal-sessions.live.json` — a verbatim capture of
 * `GET /cli/list-terminal-sessions?includeClosed=false` from a running
 * RealTimeX host (paths scrubbed, nothing else edited).
 *
 * The bug this guards against was invisible to hand-written mocks: every mock
 * in this file described the payload as `{ results: { workspaces } }`, the
 * parser read the same invented shape, and both agreed with each other while
 * disagreeing with the host, which returns `workspaces` at the top level. The
 * parser therefore saw zero sessions in production for every response, so
 * `resolveActiveTerminalSessionIdForThread` returned null and the orchestrator
 * terminal was never torn down. Assert against captured bytes, not a mock.
 */
describe("list-terminal-sessions parsing (captured host payload)", () => {
  const env = { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" };
  const liveBody = () =>
    new Response(JSON.stringify(liveTerminalSessionsPayload), { status: 200 });

  /**
   * The host — not the caller — applies `workspaceSlug`/`threadSlug`, so a mock
   * that ignores the query would let a caller that never sends them still pass.
   */
  const liveHost = () =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const workspaceSlug = url.searchParams.get("workspaceSlug");
      const threadSlug = url.searchParams.get("threadSlug");
      const workspaces = liveTerminalSessionsPayload.workspaces
        .filter((workspace) => !workspaceSlug || workspace.workspaceSlug === workspaceSlug)
        .map((workspace) => ({
          ...workspace,
          threads: workspace.threads.filter(
            (thread) => !threadSlug || thread.threadSlug === threadSlug
          ),
        }));
      return new Response(
        JSON.stringify({ ...liveTerminalSessionsPayload, workspaces }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

  it("sees every session the host reported", async () => {
    const expectedIds = liveTerminalSessionsPayload.workspaces.flatMap((workspace) =>
      workspace.threads.flatMap((thread) => thread.sessions.map((session) => session.id))
    );
    expect(expectedIds.length).toBeGreaterThan(0);

    const sessions = await listTerminalRuntimeSessions(
      { includeClosed: false },
      env,
      vi.fn().mockResolvedValue(liveBody()) as unknown as typeof fetch
    );

    expect(sessions.map((session) => session.id)).toEqual(expectedIds);
  });

  it("resolves the orchestrator thread's live session id", async () => {
    const sessionId = await resolveActiveTerminalSessionIdForThread(
      "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f",
      "signals-orchestrator",
      env,
      liveHost()
    );

    expect(sessionId).toBe("cli-agent:8369c139-e79f-4776-84d6-4077a7a5673c");
  });

  it("still reads a busy chat-linked turn out of the captured shape", async () => {
    const sessions = await listTerminalRuntimeSessions(
      { includeClosed: false },
      env,
      vi.fn().mockResolvedValue(liveBody()) as unknown as typeof fetch
    );

    const busy = sessions.find(
      (session) => session.id === "cli-agent:2e68d09f-9487-49de-bfbd-92dc671fbd83"
    );
    expect(isTerminalRuntimeSessionBusy(busy)).toBe(true);
  });

  it("still reads the legacy results-wrapped shape", async () => {
    const wrapped = { success: true, results: { workspaces: liveTerminalSessionsPayload.workspaces } };
    const sessions = await listTerminalRuntimeSessions(
      { includeClosed: false },
      env,
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(wrapped), { status: 200 })
      ) as unknown as typeof fetch
    );

    expect(sessions).toHaveLength(3);
  });
});
