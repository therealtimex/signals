import { describe, expect, it } from "vitest";
import {
  createWorkflowRun,
  listRunningTerminalAgentWorkflowRuns,
  listWorkflowRuns,
} from "@/lib/db/queries/workflows";

describe("listWorkflowRuns", () => {
  it("excludes child runs when topLevelOnly is true", () => {
    const parent = createWorkflowRun({
      workflowType: "enrich",
      status: "running",
      config: JSON.stringify({ templateName: "Contact profile pipeline" }),
      trigger: "template",
    });
    createWorkflowRun({
      workflowType: "persona",
      status: "completed",
      config: JSON.stringify({ contactId: "contact-1" }),
      trigger: "user",
      parentWorkflowId: parent.id,
      completedAt: Math.floor(Date.now() / 1000),
    });

    const allRuns = listWorkflowRuns({ pageSize: 50 });
    const topLevelRuns = listWorkflowRuns({ pageSize: 50, topLevelOnly: true });

    expect(allRuns.data.some((run) => run.id === parent.id)).toBe(true);
    expect(allRuns.data.some((run) => run.parentWorkflowId === parent.id)).toBe(
      true,
    );
    expect(topLevelRuns.data.some((run) => run.id === parent.id)).toBe(true);
    expect(
      topLevelRuns.data.some((run) => run.parentWorkflowId === parent.id),
    ).toBe(false);
  });
});

describe("listRunningTerminalAgentWorkflowRuns", () => {
  it("returns only running non-persona runs with a linked terminal session", () => {
    createWorkflowRun({
      workflowType: "search",
      status: "running",
      config: JSON.stringify({ rtxRuntimeSessionId: "cli-agent:workflow-1" }),
      trigger: "template",
    });
    createWorkflowRun({
      workflowType: "persona",
      status: "running",
      config: JSON.stringify({ rtxRuntimeSessionId: "cli-agent:persona-1" }),
      trigger: "user",
    });
    createWorkflowRun({
      workflowType: "search",
      status: "running",
      config: JSON.stringify({ rtxWorkspaceSlug: "signals" }),
      trigger: "template",
    });

    const runs = listRunningTerminalAgentWorkflowRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.config).toContain("cli-agent:workflow-1");
  });
});
