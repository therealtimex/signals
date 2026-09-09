import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "@/lib/db/types";
import { WorkflowStepTimeline } from "@/components/workflow-step-timeline";

describe("WorkflowStepTimeline agent dispatch metadata", () => {
  it("replaces the raw runtime session ID with a compact thread action", () => {
    const step = {
      id: "step-1",
      workflowRunId: "run-1",
      stepIndex: 0,
      stepType: "tool_call",
      status: "completed",
      contactId: null,
      url: null,
      tool: "rtx_terminal_agent",
      input: "{}",
      output: JSON.stringify({
        runtimeSessionId: "cli-agent:sensitive-runtime-detail",
        threadResolution: "reused",
        threadName: "Network Snowball",
      }),
      error: null,
      durationMs: 0,
      createdAt: 1_800_000_000,
    } satisfies WorkflowStep;

    const html = renderToStaticMarkup(
      createElement(WorkflowStepTimeline, {
        steps: [step],
        agentThreadAction: createElement("button", null, "Open thread"),
      }),
    );

    expect(html).not.toContain("cli-agent:sensitive-runtime-detail");
    expect(html).not.toContain("runtimeSessionId");
    expect(html).toContain("threadResolution");
    expect(html).toContain("Open thread");
  });
});
