import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleDispatchFollowOnWorkflow } from "@/lib/agent-tools/handlers";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";
import * as orchestratorCompletionThread from "@/lib/rtx/orchestrator-completion-thread";
import * as rtxEnv from "@/lib/rtx/env";
import * as orchestratorThread from "@/lib/rtx/orchestrator-thread";
import * as runtimeSessions from "@/lib/rtx/runtime-sessions";
import * as runTemplateViaRtxModule from "@/lib/agents/run-template-via-rtx";
import { resetCoreTables } from "@/test/db";

describe("dispatch_follow_on_workflow orchestrator teardown", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
    vi.spyOn(rtxEnv, "isRtxEmbedded").mockReturnValue(true);
    vi.spyOn(orchestratorThread, "getOrCreateOrchestratorThread").mockResolvedValue({
      workspaceSlug: "signals",
      threadSlug: "signals-orchestrator",
      threadName: "Signals Orchestrator",
      resolution: "reused",
    });
    vi.spyOn(runtimeSessions, "resolveActiveTerminalSessionIdForThread").mockResolvedValue(
      "cli-agent:orchestrator-1",
    );
    vi.spyOn(runTemplateViaRtxModule, "runTemplateViaRtx").mockResolvedValue({
      success: true,
      workflowRunId: "child-run-1",
      workspaceSlug: "signals",
      threadSlug: "child-thread",
      threadPath: "/workspace/signals/t/child-thread",
      threadResolution: "created",
      workflowRun: {} as never,
    });
    vi.spyOn(resourceTeardown, "finalizeChatLinkedTerminalSession").mockResolvedValue({
      browserSessionTeardown: { stopped: ["network-snowball"], failed: [] },
      terminalSessionTeardown: { scheduled: true, sessionId: "cli-agent:orchestrator-1" },
    });
    vi.spyOn(orchestratorCompletionThread, "postOrchestratorDispatchThreadMessage").mockResolvedValue({
      posted: true,
    });
  });

  it("stops browsers, posts a Done summary, and schedules orchestrator terminal release", async () => {
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
    expect(resourceTeardown.finalizeChatLinkedTerminalSession).toHaveBeenCalledWith({
      terminalSessionId: "cli-agent:orchestrator-1",
      stopAllRunningBrowsers: true,
    });
    expect(orchestratorCompletionThread.postOrchestratorDispatchThreadMessage).toHaveBeenCalled();
  });
});
