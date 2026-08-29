import { describe, expect, it, vi } from "vitest";
import {
  formatWorkflowCompletionThreadMessage,
  postWorkflowCompletionThreadMessage,
} from "@/lib/rtx/workflow-completion-thread";
import * as runtimeSessions from "@/lib/rtx/runtime-sessions";
import type { WorkflowRun } from "@/lib/db/types";

const baseRun: WorkflowRun = {
  id: "run_test",
  templateId: "tpl_test",
  workflowType: "enrich",
  status: "running",
  config: JSON.stringify({
    templateName: "Company Profile Enrichment",
    rtxWorkspaceSlug: "workspace-1",
    rtxThreadSlug: "thread-1",
  }),
  trigger: "template",
  processedItems: 0,
  successItems: 0,
  errorItems: 0,
  startedAt: 1,
  completedAt: null,
  result: null,
  errors: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("formatWorkflowCompletionThreadMessage", () => {
  it("includes template name, run id, status, and summary", () => {
    const message = formatWorkflowCompletionThreadMessage(baseRun, {
      status: "completed",
      summary: "Enriched SubVysion from subvysion.com.",
    });

    expect(message).toContain("**Company Profile Enrichment — Done**");
    expect(message).toContain("Run `run_test`");
    expect(message).toContain("Status: **completed**");
    expect(message).toContain("Enriched SubVysion from subvysion.com.");
  });
});

describe("postWorkflowCompletionThreadMessage", () => {
  it("posts a run-labelled completion message to the workflow thread", async () => {
    const appendSpy = vi
      .spyOn(runtimeSessions, "appendRtxThreadMessage")
      .mockResolvedValue({ success: true });

    const result = await postWorkflowCompletionThreadMessage(
      baseRun,
      {
        status: "completed",
        summary: "Enriched SubVysion.",
        processedItems: 1,
        successItems: 1,
      },
      { RTX_APP_ID: "app-1" }
    );

    expect(result).toEqual({ posted: true });
    expect(appendSpy).toHaveBeenCalledWith(
      {
        workspaceSlug: "workspace-1",
        threadSlug: "thread-1",
        message: expect.stringContaining("**Company Profile Enrichment — Done**"),
        reason: "Workflow run run_test completed",
      },
      { RTX_APP_ID: "app-1" },
      fetch
    );
  });

  it("skips posting when the run has no RTX thread refs", async () => {
    const appendSpy = vi.spyOn(runtimeSessions, "appendRtxThreadMessage");

    const result = await postWorkflowCompletionThreadMessage(
      { ...baseRun, config: JSON.stringify({}) },
      { status: "completed" }
    );

    expect(result).toEqual({ posted: false });
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
