import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "@/lib/db/types";
import {
  getWorkflowRunAgentThreadTarget,
  resolveWorkflowRunAgentThread,
} from "@/lib/workflows/workflow-run-agent-thread";

function run(
  input: Partial<Pick<WorkflowRun, "config" | "status" | "templateId">>,
): Pick<WorkflowRun, "config" | "status" | "templateId"> {
  return {
    config: null,
    status: "running",
    templateId: "template-1",
    ...input,
  };
}

describe("workflow run agent thread projection", () => {
  it.each([
    ["newly created", "snowball-new"],
    ["reused", "snowball-reused"],
  ])("returns the authoritative %s thread path", (_kind, threadSlug) => {
    const source = run({
      config: JSON.stringify({
        rtxWorkspaceSlug: "signals",
        rtxThreadSlug: threadSlug,
        rtxRuntimeSessionId: "cli-agent:must-not-be-used-as-identity",
      }),
    });

    expect(getWorkflowRunAgentThreadTarget(source)).toEqual({
      workspaceSlug: "signals",
      threadSlug,
      threadPath: `/workspace/signals/t/${threadSlug}`,
    });
    expect(resolveWorkflowRunAgentThread(source)).toEqual({
      state: "available",
      threadPath: `/workspace/signals/t/${threadSlug}`,
    });
  });

  it("reports connecting while a template run is awaiting its server-resolved thread", () => {
    expect(resolveWorkflowRunAgentThread(run({ config: "{}" }))).toEqual({
      state: "connecting",
      threadPath: null,
    });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "hides a missing thread once a run is %s",
    (status) => {
      expect(resolveWorkflowRunAgentThread(run({ config: "{}", status }))).toEqual({
        state: "none",
        threadPath: null,
      });
    },
  );

  it("does not invent a target from a runtime session ID or partial thread refs", () => {
    const source = run({
      config: JSON.stringify({
        rtxWorkspaceSlug: "signals",
        rtxRuntimeSessionId: "cli-agent:session-only",
        threadName: "Network Snowball",
      }),
      status: "completed",
    });

    expect(getWorkflowRunAgentThreadTarget(source)).toBeNull();
    expect(resolveWorkflowRunAgentThread(source)).toEqual({
      state: "none",
      threadPath: null,
    });
  });

  it("hides the control for a non-template run without a stored target", () => {
    expect(resolveWorkflowRunAgentThread(run({ templateId: null }))).toEqual({
      state: "none",
      threadPath: null,
    });
  });
});
