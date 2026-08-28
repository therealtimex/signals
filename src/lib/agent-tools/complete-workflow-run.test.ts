import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createContact } from "@/lib/db/queries/contacts";
import { createWorkflowRun, getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
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

  it("schedules terminal release after stopping browsers on completion", async () => {
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

    const browserSpy = vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: ["network-snowball"],
      failed: [],
    });
    const scheduleSpy = vi
      .spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease")
      .mockReturnValue({ scheduled: true, sessionId: "cli-agent:session-abc" });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Mapped investor cluster",
    });

    expect(result.success).toBe(true);
    expect(browserSpy).toHaveBeenCalledWith({ stopAllRunning: true });
    expect(scheduleSpy).toHaveBeenCalledWith("cli-agent:session-abc");
    expect(result.terminalSessionTeardown).toEqual({
      scheduled: true,
      sessionId: "cli-agent:session-abc",
    });
    expect(result.browserSessionTeardown).toEqual({
      stopped: ["network-snowball"],
      failed: [],
    });
    expect(result.message).toContain("Terminal session release scheduled.");
    expect(result.message).toContain("Browser sessions stopped: network-snowball.");
  });

  it("still completes the workflow when no runtime session is stored", async () => {
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
        config: JSON.stringify({}),
      }).id,
      {
        config: JSON.stringify({}),
      }
    )!;

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    const scheduleSpy = vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease");

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      summary: "Done",
    });

    expect(result.success).toBe(true);
    expect(scheduleSpy).toHaveBeenCalledWith(null);
    expect(result.terminalSessionTeardown).toEqual({ scheduled: false });
  });

  it("unions explicit, stored, and birth cohorts while leaving config as fallback only", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });
    const explicit = createContact({ name: "Explicit" });
    const stored = createContact({ name: "Stored" });
    const config = createContact({ name: "Config fallback" });
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ createdContactIds: [stored.id] }),
      config: JSON.stringify({ targetContactIds: [config.id] }),
    });
    const birth = createContact(
      { name: "Birth" },
      { tag: "agent:create_contact", workflowRunId: run.id, templateId: template.id },
    );

    const emitSpy = vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      createdContactIds: [explicit.id],
    });

    expect(result.createdContactIds).toEqual([explicit.id, stored.id, birth.id]);
    expect(result.cohortSources).toEqual(["explicit", "stored", "birth"]);
    expect(result.processedItems).toBe(3);
    expect(getWorkflowRun(run.id)?.processedItems).toBe(3);
    expect(emitSpy).toHaveBeenCalledWith(run.id, {
      summary: undefined,
      createdContactIds: [explicit.id, stored.id, birth.id],
    });
  });

  it("preserves an explicitly supplied processed-item count", async () => {
    const first = createContact({ name: "First" });
    const second = createContact({ name: "Second" });
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      result: JSON.stringify({ createdContactIds: [first.id, second.id] }),
    });

    vi.spyOn(workflowEvents, "emitWorkflowCompletedEvent").mockResolvedValue(
      mockWorkflowCompletedEvent,
    );
    vi.spyOn(resourceTeardown, "stopRunningRtxBrowserSessions").mockResolvedValue({
      stopped: [],
      failed: [],
    });
    vi.spyOn(resourceTeardown, "scheduleWorkflowTerminalSessionRelease").mockReturnValue({
      scheduled: true,
      sessionId: null,
    });

    const result = await handleCompleteWorkflowRun({
      runId: run.id,
      status: "completed",
      processedItems: 1,
    });

    expect(result.createdContactIds).toEqual([first.id, second.id]);
    expect(result.processedItems).toBe(1);
    expect(getWorkflowRun(run.id)?.processedItems).toBe(1);
  });
});
