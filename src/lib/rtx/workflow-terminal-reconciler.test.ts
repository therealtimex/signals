import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import {
  beginWorkflowTerminalDispatch,
  readWorkflowTerminalLifecycle,
  requestWorkflowTerminalCleanupState,
  RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { reconcileWorkflowTerminalCleanups } from "@/lib/rtx/workflow-terminal-reconciler";
import {
  initWorkflowTerminalCleanupReconciler,
  stopWorkflowTerminalCleanupReconciler,
  WORKFLOW_TERMINAL_CLEANUP_INTERVAL_MS,
} from "@/lib/rtx/workflow-terminal-reconciler-runner";
import { resetCoreTables } from "@/test/db";

const env = {
  RTX_APP_ID: "signals",
  RTX_API_BASE_URL: "http://127.0.0.1:3001",
};

function createCleanupRun(
  state: "completed" | "failed" | "running" = "completed",
) {
  const routing = {
    runId: "run-placeholder",
    workspaceSlug: "signals",
    threadSlug: "workflow-thread",
    briefPath: "/workspace/.signals/workflow-runs/run-placeholder/brief.md",
    message: "Run run-placeholder from /workspace/.signals/workflow-runs/run-placeholder/brief.md",
  };
  const run = createWorkflowRun({
    workflowType: "agent",
    status: state,
    trigger: "template",
    config: "{}",
  });
  routing.runId = run.id;
  routing.briefPath = `/workspace/.signals/workflow-runs/${run.id}/brief.md`;
  routing.message = `Run ${run.id} from ${routing.briefPath}`;
  const started = beginWorkflowTerminalDispatch("{}", routing, 1_000);
  const accepted = settleWorkflowTerminalDispatch(
    started,
    {
      state: "accepted",
      descriptor: {
        id: "cli-agent:workflow",
        aliases: ["terminal-card:workflow"],
      },
    },
    2_000,
  );
  const requested = requestWorkflowTerminalCleanupState(
    accepted,
    "workflow_completed_resumable",
    3_000,
  );
  const updated = getWorkflowRun(run.id)!;
  updateWorkflowRun(run.id, {
    config: writeWorkflowTerminalLifecycle(updated.config, requested),
  });
  return getWorkflowRun(run.id)!;
}

function listResponse(
  sessions: Record<string, unknown>[],
  guardedTermination: number | null = 1,
) {
  return new Response(
    JSON.stringify({
      success: true,
      ...(guardedTermination === null
        ? {}
        : { capabilities: { guardedTermination } }),
      sessions,
    }),
    { status: 200 },
  );
}

describe("workflow terminal cleanup reconciler", () => {
  beforeEach(() => {
    stopWorkflowTerminalCleanupReconciler();
    resetCoreTables();
    vi.useRealTimers();
  });

  afterEach(() => {
    stopWorkflowTerminalCleanupReconciler();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects malformed versioned lifecycle state without touching the host", async () => {
    const run = createWorkflowRun({
      workflowType: "agent",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        rtxTerminalLifecycle: {
          version: 1,
          dispatch: {},
          cleanup: { requested: true, state: "pending" },
        },
      }),
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result).toEqual({ scanned: 1, outcomes: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not revoke a live cleanup lease when cleanup is requested again", () => {
    const run = createCleanupRun();
    const lifecycle = readWorkflowTerminalLifecycle(run.config)!;
    const leased = {
      ...lifecycle,
      cleanup: {
        ...lifecycle.cleanup,
        state: "leased" as const,
        leaseUntil: 20_000,
      },
    };

    const requested = requestWorkflowTerminalCleanupState(
      leased,
      "duplicate_completion",
      10_000,
    );

    expect(requested.cleanup).toMatchObject({
      requested: true,
      state: "leased",
      leaseUntil: 20_000,
      reason: "duplicate_completion",
    });
  });

  it("persists a bounded retry while the exact session turn remains busy", async () => {
    const run = createCleanupRun();
    const updatedAt = run.updatedAt;
    const fetchImpl = vi.fn(async () =>
      listResponse([
        {
          id: "cli-agent:workflow",
          activityCardId: "terminal-card:workflow",
          workspaceSlug: "signals",
          threadSlug: "workflow-thread",
          status: "running",
          chatLinkedTurnStateKnown: true,
          chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
        },
      ]),
    ) as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result.outcomes).toEqual([
      { runId: run.id, released: false, reason: "terminal_session_busy" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup).toMatchObject({
      state: "retry",
      attempt: 1,
      nextAttemptAt: 15_000,
      lastError: "terminal_session_busy",
    });
    expect(getWorkflowRun(run.id)?.updatedAt).toBe(updatedAt);
  });

  it("persists an uncertain launch match so idle listings can reconcile after sourcePrompt disappears", async () => {
    const run = createWorkflowRun({
      workflowType: "agent",
      status: "failed",
      trigger: "template",
      config: "{}",
    });
    const routing = {
      runId: run.id,
      workspaceSlug: "signals",
      threadSlug: "workflow-thread",
      briefPath: `/workspace/.signals/workflow-runs/${run.id}/brief.md`,
      message: `Run ${run.id}`,
    };
    const lifecycle = settleWorkflowTerminalDispatch(
      beginWorkflowTerminalDispatch(run.config, routing, 1_000),
      { state: "uncertain", error: "relay timeout" },
      2_000,
    );
    updateWorkflowRun(run.id, {
      config: writeWorkflowTerminalLifecycle(run.config, lifecycle),
    });

    let listCalls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, closed: true }), {
          status: 200,
        });
      }
      listCalls += 1;
      if (listCalls === 1) {
        return listResponse([
          {
            id: "cli-agent:uncertain",
            activityCardId: "terminal-card:uncertain",
            workspaceSlug: "signals",
            threadSlug: "workflow-thread",
            sourcePrompt: `${routing.message} from ${routing.briefPath}`,
            status: "running",
            chatLinkedTurnStateKnown: true,
            chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
          },
        ]);
      }
      if (listCalls === 2) {
        return listResponse([
          {
            id: "pty:uncertain",
            activityCardId: "terminal-card:uncertain",
            workspaceSlug: "signals",
            threadSlug: "workflow-thread",
            status: "running",
            chatLinkedTurnStateKnown: true,
            chatLinkedPendingTurn: null,
          },
        ]);
      }
      return listResponse([]);
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const busy = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });
    expect(busy.outcomes[0]?.reason).toBe("terminal_session_busy");
    expect(
      readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.dispatch.session,
    ).toEqual({
      id: "cli-agent:uncertain",
      aliases: ["cli-agent:uncertain", "terminal-card:uncertain"],
    });

    const settled = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 20_000,
      env,
      fetchImpl,
    });

    expect(settled.outcomes).toEqual([
      { runId: run.id, released: true, reason: "released" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const terminateCall = fetchMock.mock.calls.find(([, request]) => request?.method === "POST");
    expect(String(terminateCall?.[0])).toContain("pty%3Auncertain");
    expect(
      readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.dispatch.session
        ?.aliases,
    ).toEqual([
      "cli-agent:uncertain",
      "terminal-card:uncertain",
      "pty:uncertain",
    ]);
  });

  it("keeps an unobserved uncertain launch pending when an authoritative list is empty", async () => {
    const run = createWorkflowRun({
      workflowType: "agent",
      status: "failed",
      trigger: "template",
      config: "{}",
    });
    const lifecycle = settleWorkflowTerminalDispatch(
      beginWorkflowTerminalDispatch(
        run.config,
        {
          runId: run.id,
          workspaceSlug: "signals",
          threadSlug: "workflow-thread",
          briefPath: `/workspace/${run.id}/brief.md`,
          message: `Run ${run.id}`,
        },
        1_000,
      ),
      { state: "uncertain", error: "relay timeout" },
      2_000,
    );
    updateWorkflowRun(run.id, {
      config: writeWorkflowTerminalLifecycle(run.config, lifecycle),
    });
    const fetchImpl = vi.fn(async () => listResponse([])) as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result.outcomes[0]).toMatchObject({
      released: false,
      reason: "runtime_session_unobserved",
    });
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup.state).toBe(
      "retry",
    );
  });

  it("reconciles a due orchestrator lifecycle stored on a terminal parent run", async () => {
    const run = createWorkflowRun({
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: "{}",
    });
    const orchestratorLifecycle = requestWorkflowTerminalCleanupState(
      settleWorkflowTerminalDispatch(
        beginWorkflowTerminalDispatch(
          run.config,
          {
            runId: run.id,
            workspaceSlug: "signals",
            threadSlug: "signals-orchestrator",
            briefPath: `/workspace/orchestrator-events/${run.id}/brief.md`,
            message: `Route ${run.id}`,
          },
          1_000,
          {
            key: RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
            cleanupRequested: false,
          },
        ),
        {
          state: "accepted",
          descriptor: { id: "cli-agent:orchestrator" },
        },
        2_000,
      ),
      "workflow_completed_resumable",
      3_000,
    );
    updateWorkflowRun(run.id, {
      config: writeWorkflowTerminalLifecycle(
        run.config,
        orchestratorLifecycle,
        RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
      ),
    });
    let listCalls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ success: true, closed: true }), {
          status: 200,
        });
      }
      listCalls += 1;
      return listResponse(
        listCalls === 1
          ? [
              {
                id: "cli-agent:orchestrator",
                workspaceSlug: "signals",
                threadSlug: "signals-orchestrator",
                status: "running",
                chatLinkedTurnStateKnown: true,
                chatLinkedPendingTurn: null,
              },
            ]
          : [],
      );
    }) as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result).toMatchObject({
      scanned: 1,
      outcomes: [{ runId: run.id, released: true, reason: "released" }],
    });
    expect(
      readWorkflowTerminalLifecycle(
        getWorkflowRun(run.id)?.config,
        RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
      )?.cleanup.state,
    ).toBe("released");
  });

  it("defers cleanup while another nonterminal workflow owns the same thread", async () => {
    const completed = createCleanupRun();
    createCleanupRun("running");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        throw new Error("must not terminate a session owned by a running workflow");
      }
      return listResponse([
        {
          id: "cli-agent:workflow",
          activityCardId: "terminal-card:workflow",
          workspaceSlug: "signals",
          threadSlug: "workflow-thread",
          status: "running",
          chatLinkedTurnStateKnown: true,
          chatLinkedPendingTurn: null,
        },
      ]);
    });

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [completed.id],
      now: 10_000,
      env,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.outcomes[0]).toMatchObject({
      released: false,
      reason: "runtime_owned_by_nonterminal_workflow",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replays persisted cleanup and retries it when workflow scheduling is disabled", async () => {
    vi.stubEnv("SIGNALS_SCHEDULER_ENABLED", "0");
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const run = createCleanupRun();
    let listCalls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      listCalls += 1;
      if (listCalls === 1) {
        return listResponse([
          {
            id: "cli-agent:workflow",
            activityCardId: "terminal-card:workflow",
            workspaceSlug: "signals",
            threadSlug: "workflow-thread",
            status: "running",
            chatLinkedTurnStateKnown: true,
            chatLinkedPendingTurn: { id: "turn-1", state: "capturing" },
          },
        ]);
      }
      if (listCalls === 2) {
        return listResponse([
          {
            id: "cli-agent:workflow",
            activityCardId: "terminal-card:workflow",
            workspaceSlug: "signals",
            threadSlug: "workflow-thread",
            status: "running",
            chatLinkedTurnStateKnown: true,
            chatLinkedPendingTurn: null,
          },
        ]);
      }
      return listResponse([]);
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await initWorkflowTerminalCleanupReconciler({
      reconcile: () =>
        reconcileWorkflowTerminalCleanups({ env, fetchImpl }),
    });

    expect(process.env.SIGNALS_SCHEDULER_ENABLED).toBe("0");
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup).toMatchObject({
      state: "retry",
      nextAttemptAt: 15_000,
      lastError: "terminal_session_busy",
    });

    await vi.advanceTimersByTimeAsync(WORKFLOW_TERMINAL_CLEANUP_INTERVAL_MS);

    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup).toMatchObject({
      state: "released",
      attempt: 2,
      releasedAt: 70_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      fetchMock.mock.calls.some(([, request]) => request?.method === "POST"),
    ).toBe(true);
  });

  it("retains cleanup intent without destructive calls when the host lacks guards", async () => {
    const run = createCleanupRun();
    const fetchImpl = vi.fn(async () => listResponse([], null)) as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result.outcomes[0]).toMatchObject({
      released: false,
      reason: "host_guard_unavailable",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup.state).toBe(
      "retry",
    );
  });

  it("does not release a workflow that is still nonterminal", async () => {
    const run = createCleanupRun("running");
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      now: 10_000,
      env,
      fetchImpl,
    });

    expect(result.outcomes[0]).toMatchObject({
      released: false,
      reason: "workflow_not_terminal",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
