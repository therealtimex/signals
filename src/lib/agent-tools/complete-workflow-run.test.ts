import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleCompleteWorkflowRun } from "@/lib/agent-tools/handlers";
import * as workflowEvents from "@/lib/webhooks/workflow-events";
import * as resourceTeardown from "@/lib/rtx/resource-teardown";

const mockWorkflowCompletedEvent: workflowEvents.EmitWorkflowCompletedResult = {
  emitted: true,
  event: {
    event: "workflow.completed",
    runId: "run_test",
    templateId: "tpl_test",
    templateName: "Network Snowball",
    templateType: "search",
    status: "completed",
    createdContactIds: [],
    totalProcessed: 0,
    timestamp: 1,
  },
  routingRecommendation: { suggestedAction: "review", rationale: "test" },
};

describe("complete_workflow_run terminal teardown", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("terminates the linked RTX runtime session after completion", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      config: JSON.stringify({
        rtxRuntimeSessionId: "cli-agent:session-abc",
      }),
    });

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent
    );

    const releaseSpy = vi.spyOn(resourceTeardown, "releaseAgentLaneResources").mockResolvedValue({
      terminal: { success: true, terminated: true },
      browser: { stopped: ["network-snowball"], failed: [] },
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Mapped investor cluster",
    });

    expect(result.success).toBe(true);
    expect(releaseSpy).toHaveBeenCalledWith({
      terminalSessionId: "cli-agent:session-abc",
      stopAllRunningBrowserSessions: true,
    });
    expect(result.terminalSessionTeardown).toEqual({ terminated: true });
    expect(result.browserSessionTeardown).toEqual({
      stopped: ["network-snowball"],
      failed: [],
    });
    expect(result.message).toContain("Terminal session released.");
    expect(result.message).toContain("Browser sessions stopped: network-snowball.");
  });

  it("still completes the workflow when terminal teardown fails", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const run = updateWorkflowRun(
      createWorkflowRun({
        templateId: template.id,
        workflowType: "search",
        status: "running",
        trigger: "template",
        config: JSON.stringify({
          rtxRuntimeSessionId: "cli-agent:missing",
        }),
      }).id,
      {
        config: JSON.stringify({
          rtxRuntimeSessionId: "cli-agent:missing",
        }),
      }
    )!;

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent
    );

    vi.spyOn(resourceTeardown, "releaseAgentLaneResources").mockResolvedValue({
      terminal: { success: false, error: "session not found" },
      browser: { stopped: [], failed: [] },
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Done",
    });

    expect(result.success).toBe(true);
    expect(result.terminalSessionTeardown).toEqual({ error: "session not found" });
    expect(result.message).toContain("Terminal session teardown failed");
  });
});
