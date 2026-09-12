import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import * as browserSessions from "@/lib/rtx/browser-sessions";
import {
  beginWorkflowTerminalDispatch,
  readWorkflowTerminalLifecycle,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { reconcileWorkflowTerminalCleanups } from "@/lib/rtx/workflow-terminal-reconciler";
import {
  isWorkflowRunTerminalTimeout,
  releaseStaleWorkflowTerminalRuns,
  releaseTimedOutWorkflowTerminalRun,
} from "@/lib/rtx/workflow-run-terminal-watchdog";
import { resetCoreTables } from "@/test/db";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLeaseById,
} from "@/lib/leases/session-lease";

describe("workflow-run terminal watchdog", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("detects running workflow runs past the timeout anchor", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(
      isWorkflowRunTerminalTimeout(
        { status: "running", startedAt: nowSec - 7200, updatedAt: nowSec },
        Date.now(),
        3_600_000,
      ),
    ).toBe(true);
    expect(
      isWorkflowRunTerminalTimeout(
        { status: "running", startedAt: nowSec - 60, updatedAt: nowSec },
        Date.now(),
        3_600_000,
      ),
    ).toBe(false);
  });

  it("fails timed-out runs and releases linked terminal sessions", async () => {
    const template = createTemplate({
      name: "Company Profile Enrichment",
      templateType: "enrichment",
      status: "active",
    });
    const startedAt = Math.floor(Date.now() / 1000) - 8 * 60 * 60;
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      startedAt,
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:stale-workflow",
        rtxWorkspaceSlug: "signals",
        rtxThreadSlug: "enrichment-thread",
      }),
    });

    const browserSpy = vi
      .spyOn(resourceTeardown, "stopRunningRtxBrowserSessions")
      .mockResolvedValue({ stopped: ["network-snowball"], failed: [] });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const result = await releaseTimedOutWorkflowTerminalRun(run.id);
    expect(result).toMatchObject({ released: true, runId: run.id });
    expect(getWorkflowRun(run.id)).toMatchObject({
      status: "failed",
      completedAt: expect.any(Number),
    });
    expect(browserSpy).toHaveBeenCalledWith(
      { stopAllRunning: true },
      expect.anything(),
      expect.anything(),
    );
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup).toMatchObject({
      requested: true,
      state: "pending",
    });
  });

  it("recovers a process-interrupted dispatch that never stored a session id", async () => {
    const startedAt = Math.floor(Date.now() / 1000) - 8 * 60 * 60;
    const run = createWorkflowRun({
      workflowType: "agent",
      status: "running",
      trigger: "template",
      startedAt,
      config: "{}",
    });
    const lifecycle = beginWorkflowTerminalDispatch(
      run.config,
      {
        runId: run.id,
        workspaceSlug: "signals",
        threadSlug: "interrupted-dispatch",
        briefPath: `/workspace/workflow-runs/${run.id}/brief.md`,
        message: `Run ${run.id} from workflow-runs/${run.id}/brief.md`,
      },
      startedAt * 1_000,
    );
    updateWorkflowRun(run.id, {
      config: writeWorkflowTerminalLifecycle(run.config, lifecycle),
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const sweep = await releaseStaleWorkflowTerminalRuns();

    expect(sweep.released).toEqual([run.id]);
    expect(getWorkflowRun(run.id)?.status).toBe("failed");
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup).toMatchObject({
      requested: true,
      state: "pending",
    });
  });

  it("sweeps only timed-out terminal-agent workflow runs", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });
    const stale = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      startedAt: Math.floor(Date.now() / 1000) - 8 * 60 * 60,
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:stale-1",
        rtxWorkspaceSlug: "signals",
        rtxThreadSlug: "snowball-thread",
      }),
    });
    createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      startedAt: Math.floor(Date.now() / 1000) - 120,
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:fresh-1",
      }),
    });

    const releaseSpy = vi
      .spyOn(resourceTeardown, "stopRunningRtxBrowserSessions")
      .mockResolvedValue({ stopped: [], failed: [] });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const sweep = await releaseStaleWorkflowTerminalRuns();
    expect(sweep.scanned).toBe(2);
    expect(sweep.released).toEqual([stale.id]);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("reconciles guarded terminal release after timing out a workflow run", async () => {
    const template = createTemplate({
      name: "Company Profile Enrichment",
      templateType: "enrichment",
      status: "active",
    });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      startedAt: Math.floor(Date.now() / 1000) - 8 * 60 * 60,
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:timed-out-workflow",
        rtxWorkspaceSlug: "signals",
        rtxThreadSlug: "enrichment-thread",
      }),
    });

    vi.spyOn(browserSessions, "listRtxBrowserSessions").mockResolvedValue([]);
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const result = await releaseTimedOutWorkflowTerminalRun(run.id);
    expect(result).toMatchObject({ released: true, runId: run.id });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/cli/list-terminal-sessions")) {
        const priorLists = fetchImpl.mock.calls.filter(([called]) =>
          String(called).includes("/cli/list-terminal-sessions"),
        ).length;
        return new Response(
          JSON.stringify({
            success: true,
            capabilities: { guardedTermination: 1 },
            sessions:
              priorLists === 1
                ? [
                    {
                      id: "cli-agent:timed-out-workflow",
                      activityCardId: "terminal-card:timed-out-workflow",
                      status: "running",
                      workspaceSlug: "signals",
                      threadSlug: "enrichment-thread",
                      chatLinkedTurnStateKnown: true,
                      chatLinkedPendingTurn: null,
                    },
                  ]
                : [],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/cli/terminate-terminal-session/")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          reason: "workflow_timed_out_resumable",
          guard: {
            version: 1,
            workspaceSlug: "signals",
            threadSlug: "enrichment-thread",
            expectedAliases: [
              "cli-agent:timed-out-workflow",
              "terminal-card:timed-out-workflow",
            ],
            expectedTurn: { known: true, id: null, state: null },
          },
        });
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    });
    const sweep = await reconcileWorkflowTerminalCleanups({
      runIds: [run.id],
      env: {
        RTX_APP_ID: "signals",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
      },
      fetchImpl,
    });

    expect(sweep.outcomes).toEqual([
      { runId: run.id, released: true, reason: "released" },
    ]);
    expect(readWorkflowTerminalLifecycle(getWorkflowRun(run.id)?.config)?.cleanup.state).toBe(
      "released",
    );
  });

  it("releases a timed-out contact research lease after browser teardown", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/current",
      handle: "/in/current",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    const lease = acquireSessionLease(connection.id, {
      holder: "contact-web-research:timed-out",
      targetId: target.id,
      intent: "browse",
      ttlSeconds: 600,
    });
    const run = createWorkflowRun({
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      startedAt: Math.floor(Date.now() / 1000) - 8 * 60 * 60,
      config: JSON.stringify({
        contactWebResearch: { version: 1 },
        rtxRuntimeSessionId: "cli-agent:research-timeout",
        researchTarget: {
          targetId: target.id,
          platform: "linkedin",
          source: "default",
          sessionName: "signals-publish",
          startUrl: "https://www.linkedin.com/in/current",
          expectedHandle: "/in/current",
          verifiedHandle: "/in/current",
          leaseId: lease.leaseId,
          leaseExpiresAt: lease.expiresAt,
          preparedAt: Math.floor(Date.now() / 1000),
        },
      }),
    });

    vi.spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession").mockResolvedValue({
      browserSessionTeardown: { stopped: ["signals-publish"], failed: [] },
      terminalSessionTeardown: {
        scheduled: true,
        sessionId: "cli-agent:research-timeout",
      },
    });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    await expect(releaseTimedOutWorkflowTerminalRun(run.id)).resolves.toMatchObject({
      released: true,
    });
    expect(getSessionLeaseById(lease.leaseId)).toBeUndefined();
  });
});
