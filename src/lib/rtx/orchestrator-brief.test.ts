import { describe, it, expect } from "vitest";
import { buildOrchestratorBriefMarkdown } from "./orchestrator-brief";
import { buildOrchestratorBriefRoutingMessage, orchestratorEventBriefRelativePath } from "./workspace-brief-files";
import type { WorkflowCompletedEventPayload } from "@/lib/webhooks/workflow-events";

describe("orchestrator-brief", () => {
  const samplePayload: WorkflowCompletedEventPayload = {
    event: "workflow.completed",
    runId: "run_test_123",
    templateId: "tpl_snowball",
    templateName: "Network Snowball",
    templateType: "search",
    status: "completed",
    createdContactIds: ["c1", "c2"],
    totalProcessed: 2,
    summary: "Mapped 2 connected nodes",
    timestamp: 1787600000,
    cascadeConfig: {
      followOnActions: ["profile_pipeline", "contact_nurture", "agentic_router"],
      cascadePolicy: "immediate",
      maxCascadeDepth: 3,
      currentDepth: 0,
    },
    targetThread: {
      name: "Signals Orchestrator",
      slug: "signals-orchestrator",
    },
  };

  it("builds a structured markdown brief with metadata, recommendation, and teardown protocol", () => {
    const markdown = buildOrchestratorBriefMarkdown({
      eventPayload: samplePayload,
      routingRecommendation: {
        suggestedAction: "patrol",
        rationale: "Discovered active founders. Deploy Social Patrol.",
      },
      signalsBaseUrl: "http://localhost:3010",
    });

    expect(markdown).toContain("# Signals Orchestrator Handoff Brief");
    expect(markdown).toContain("run_test_123");
    expect(markdown).toContain("Network Snowball");
    expect(markdown).toContain("- `c1`");
    expect(markdown).toContain("- `c2`");
    expect(markdown).toContain("Recommended Next Action:** `patrol`");
    expect(markdown).toContain("Discovered active founders. Deploy Social Patrol.");
    expect(markdown).toContain("TEARDOWN & RESOURCE RELEASE PROTOCOL");
    expect(markdown).toContain("dispatch_follow_on_workflow");
    expect(markdown).toContain("schedules release of this orchestrator terminal session");
  });

  it("formats relative brief path correctly", () => {
    expect(orchestratorEventBriefRelativePath("run_abc")).toBe("orchestrator-events/run_abc/brief.md");
  });

  it("formats routing messages with @file reference", () => {
    const message = buildOrchestratorBriefRoutingMessage({
      runId: "run_test_123",
      templateName: "Network Snowball",
      suggestedAction: "patrol",
    });

    expect(message).toContain("Signals orchestrator handoff -> Network Snowball (run_test_123)");
    expect(message).toContain("Event: workflow.completed");
    expect(message).toContain("Recommendation: patrol");
    expect(message).toContain("File: @orchestrator-events/run_test_123/brief.md");
  });
});
