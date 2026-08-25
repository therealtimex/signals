import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleCompleteWorkflowRun } from "@/lib/agent-tools/handlers";
import * as workflowEvents from "@/lib/webhooks/workflow-events";
import * as runtimeSessions from "@/lib/rtx/runtime-sessions";

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

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue({
      emitted: true,
      cascadeResult: null,
      routingRecommendation: { suggestedAction: "review", rationale: "test" },
    });

    const terminateSpy = vi
      .spyOn(runtimeSessions, "terminateTerminalRuntimeSession")
      .mockResolvedValue({ success: true, terminated: true });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Mapped investor cluster",
    });

    expect(result.success).toBe(true);
    expect(terminateSpy).toHaveBeenCalledWith("cli-agent:session-abc");
    expect(result.terminalSessionTeardown).toEqual({ terminated: true });
    expect(result.message).toContain("Terminal session released.");
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

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue({
      emitted: true,
      cascadeResult: null,
      routingRecommendation: { suggestedAction: "review", rationale: "test" },
    });

    vi.spyOn(runtimeSessions, "terminateTerminalRuntimeSession").mockResolvedValue({
      success: false,
      error: "session not found",
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
