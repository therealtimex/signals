import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as workflowCompletionThread from "@/lib/rtx/workflow-completion-thread";
import * as browserSessions from "@/lib/rtx/browser-sessions";
import * as runtimeSessions from "@/lib/rtx/runtime-sessions";
import { WORKFLOW_COMPLETED_TERMINAL_RELEASE_REASON } from "@/lib/rtx/terminal-teardown";
import {
  isWorkflowRunTerminalTimeout,
  releaseStaleWorkflowTerminalRuns,
  releaseTimedOutWorkflowTerminalRun,
} from "@/lib/rtx/workflow-run-terminal-watchdog";
import { resetCoreTables } from "@/test/db";

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

    vi.spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession").mockResolvedValue({
      browserSessionTeardown: { stopped: ["network-snowball"], failed: [] },
      terminalSessionTeardown: { scheduled: true, sessionId: "cli-agent:stale-workflow" },
    });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const result = await releaseTimedOutWorkflowTerminalRun(run.id);
    expect(result).toMatchObject({ released: true, runId: run.id });
    expect(getWorkflowRun(run.id)).toMatchObject({
      status: "failed",
      completedAt: expect.any(Number),
    });
    expect(resourceTeardown.finalizeChatLinkedTerminalSession).toHaveBeenCalledWith(
      {
        terminalSessionId: "cli-agent:stale-workflow",
        stopAllRunningBrowsers: true,
      },
      expect.anything(),
      expect.anything(),
    );
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
      .spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession")
      .mockResolvedValue({
        browserSessionTeardown: { stopped: [], failed: [] },
        terminalSessionTeardown: { scheduled: true, sessionId: "cli-agent:stale-1" },
      });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const sweep = await releaseStaleWorkflowTerminalRuns();
    expect(sweep.scanned).toBe(2);
    expect(sweep.released).toEqual([stale.id]);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("drains deferred terminal release after timing out a workflow run", async () => {
    vi.useFakeTimers();
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
    const waitSpy = vi
      .spyOn(runtimeSessions, "waitForTerminalSessionIdle")
      .mockResolvedValue({ idle: true });
    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });
    vi.spyOn(workflowCompletionThread, "postWorkflowCompletionThreadMessage").mockResolvedValue({
      posted: true,
    });

    const result = await releaseTimedOutWorkflowTerminalRun(run.id);
    expect(result).toMatchObject({ released: true, runId: run.id });

    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(waitSpy).toHaveBeenCalledWith("cli-agent:timed-out-workflow", {
      env: process.env,
      fetchImpl: fetch,
      retryDelaysMs: expect.arrayContaining([250, 14_000, 15_000, 90_000]),
    });
    expect(terminateSpy).toHaveBeenCalledWith(
      "cli-agent:timed-out-workflow",
      process.env,
      fetch,
      { reason: WORKFLOW_COMPLETED_TERMINAL_RELEASE_REASON },
    );
    vi.useRealTimers();
  });
});
