import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ORCHESTRATION_UNAVAILABLE_CODE,
  startAgentWorkflow,
} from "@/lib/agents/run-agent-workflow";
import { listWorkflowSteps } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";

describe("startAgentWorkflow", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("records a failed run with orchestration-unavailable error", () => {
    const run = startAgentWorkflow({ workflowType: "agent" });

    expect(run.status).toBe("failed");
    expect(run.errorItems).toBe(1);

    const errors = JSON.parse(run.errors ?? "[]") as string[];
    expect(errors[0]).toContain(AGENT_ORCHESTRATION_UNAVAILABLE_CODE);

    const steps = listWorkflowSteps(run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe("failed");
    expect(steps[0]?.tool).toBe("agent_runner");
  });
});
