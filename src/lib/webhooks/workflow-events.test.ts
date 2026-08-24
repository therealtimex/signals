import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { buildWorkflowCascadeConfig } from "@/lib/workflows/chaining";
import {
  emitWorkflowCompletedEvent,
  evaluateAgenticRouting,
} from "@/lib/webhooks/workflow-events";

describe("Workflow Events & Agentic Router", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("evaluates agentic routing for investor heavy cohort", () => {
    const c1 = createContact({ name: "Alice VC" });
    const c2 = createContact({ name: "Bob Angel" });
    const c3 = createContact({ name: "Charlie Dev" });

    createIdentity({
      contactId: c1.id,
      platform: "x",
      platformUserId: "alice_vc",
      headline: "General Partner at Horizon Fund",
      avatarUrl: "https://cdn.example/alice.jpg",
    });
    createIdentity({
      contactId: c2.id,
      platform: "x",
      platformUserId: "bob_angel",
      headline: "Angel Investor",
      avatarUrl: "https://cdn.example/bob.jpg",
    });
    createIdentity({
      contactId: c3.id,
      platform: "x",
      platformUserId: "charlie_dev",
      headline: "Software Engineer",
      avatarUrl: "https://cdn.example/charlie.jpg",
    });

    const evaluation = evaluateAgenticRouting([c1.id, c2.id, c3.id]);
    expect(evaluation.suggestedAction).toBe("nurture");
    expect(evaluation.rationale).toContain("high-value investor node");
  });

  it("evaluates agentic routing for unhydrated cohort", () => {
    const c1 = createContact({ name: "Founder 1" });
    const c2 = createContact({ name: "Founder 2" });

    const evaluation = evaluateAgenticRouting([c1.id, c2.id]);
    expect(evaluation.suggestedAction).toBe("profile_pipeline");
    expect(evaluation.rationale).toContain("Contact Profile Pipeline");
  });

  it("emits event and executes deterministic cascade", async () => {
    const nurtureTemplate = createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: nurtureTemplate.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["contact_nurture"],
          cascadePolicy: "immediate",
        }),
      }),
    });

    const c1 = createContact({ name: "Alice" });
    const result = await emitWorkflowCompletedEvent(parentRun.id, {
      summary: "Snowball mapped 1 node",
      createdContactIds: [c1.id],
    });

    expect(result.emitted).toBe(true);
    expect(result.event.event).toBe("workflow.completed");
    expect(result.cascadeResult?.triggered).toBe(true);
    expect(result.cascadeResult?.childRunIds).toHaveLength(1);
    expect(result.cascadeResult?.targetTemplateNames).toContain("Contact Relationship Nurture");
  });

  it("emits event with agentic router recommendation", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["agentic_router"],
        }),
      }),
    });

    const c1 = createContact({ name: "Sarah GP" });
    createIdentity({
      contactId: c1.id,
      platform: "linkedin",
      platformUserId: "sarah_gp",
      headline: "General Partner at Venture Fund",
      avatarUrl: "https://cdn.example/sarah.jpg",
    });

    const result = await emitWorkflowCompletedEvent(parentRun.id, {
      createdContactIds: [c1.id],
    });

    expect(result.emitted).toBe(true);
    expect(result.routingRecommendation?.suggestedAction).toBe("nurture");
    expect(result.cascadeResult?.followOnAction).toBe("agentic_router");
  });
});
