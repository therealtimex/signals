import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowRun,
  getWorkflowRun,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleDispatchFollowOnWorkflow } from "@/lib/agent-tools/handlers";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as orchestratorCompletionThread from "@/lib/rtx/orchestrator-completion-thread";
import * as rtxEnv from "@/lib/rtx/env";
import * as orchestratorThread from "@/lib/rtx/orchestrator-thread";
import * as runTemplateViaRtxModule from "@/lib/agents/run-template-via-rtx";
import {
  beginWorkflowTerminalDispatch,
  readWorkflowTerminalLifecycle,
  RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
  settleWorkflowTerminalDispatch,
  writeWorkflowTerminalLifecycle,
} from "@/lib/rtx/workflow-terminal-lifecycle";
import { resetCoreTables } from "@/test/db";

describe("dispatch_follow_on_workflow orchestrator teardown", () => {
  const orchestratorWorkspaceSlug = "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f";

  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    vi.spyOn(rtxEnv, "isRtxEmbedded").mockReturnValue(true);
    vi.spyOn(orchestratorThread, "getOrCreateOrchestratorThread").mockResolvedValue({
      workspaceSlug: orchestratorWorkspaceSlug,
      threadSlug: "signals-orchestrator",
      threadName: "Signals Orchestrator",
      resolution: "reused",
    });
    vi.spyOn(runTemplateViaRtxModule, "runTemplateViaRtx").mockResolvedValue({
      success: true,
      workflowRunId: "child-run-1",
      workspaceSlug: "signals",
      threadSlug: "child-thread",
      threadPath: "/workspace/signals/t/child-thread",
      threadResolution: "created",
      workflowRun: {} as never,
    });
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: ["network-snowball"],
      failed: [],
    });
    vi.spyOn(orchestratorCompletionThread, "postOrchestratorDispatchThreadMessage").mockResolvedValue({
      posted: true,
    });
  });

  it("stops browsers, posts a Done summary, and persists orchestrator terminal cleanup", async () => {
    const template = createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
    });
    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
    });
    const dispatched = settleWorkflowTerminalDispatch(
      beginWorkflowTerminalDispatch(
        parentRun.config,
        {
          runId: parentRun.id,
          workspaceSlug: orchestratorWorkspaceSlug,
          threadSlug: "signals-orchestrator",
          briefPath: `/orchestrator-events/${parentRun.id}/brief.md`,
          message: `Route ${parentRun.id}`,
        },
        1_000,
        {
          key: RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
          cleanupRequested: false,
        },
      ),
      {
        state: "accepted",
        descriptor: { id: "cli-agent:orchestrator-1" },
      },
      2_000,
    );
    updateWorkflowRun(parentRun.id, {
      config: writeWorkflowTerminalLifecycle(
        parentRun.config,
        dispatched,
        RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
      ),
    });

    const result = await handleDispatchFollowOnWorkflow({
      parentWorkflowRunId: parentRun.id,
      followOnAction: "profile_pipeline",
      contactIds: ["c_401"],
    });

    expect(result.success).toBe(true);
    expect(result.terminalSessionTeardown).toEqual({
      scheduled: true,
      sessionId: "cli-agent:orchestrator-1",
    });
    expect(result.completionThreadMessage).toEqual({ posted: true });
    expect(resourceTeardown.stopRunningRtxBrowserSessions).toHaveBeenCalledWith({
      stopAllRunning: true,
    });
    expect(
      readWorkflowTerminalLifecycle(
        getWorkflowRun(parentRun.id)?.config,
        RTX_ORCHESTRATOR_TERMINAL_LIFECYCLE_CONFIG_KEY,
      )?.cleanup,
    ).toMatchObject({
      requested: true,
      state: "pending",
      reason: "workflow_completed_resumable",
    });
    expect(orchestratorCompletionThread.postOrchestratorDispatchThreadMessage).toHaveBeenCalled();
  });
});
