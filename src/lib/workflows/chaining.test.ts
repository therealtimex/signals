import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import {
  buildWorkflowCascadeConfig,
  dispatchWorkflowCascade,
  FOLLOW_ON_ACTION_OPTIONS,
  readWorkflowCascadeConfig,
  resolveFollowOnTemplate,
} from "@/lib/workflows/chaining";

describe("Workflow Chaining & Cascading Engine", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("reads default cascade config for empty or null input", () => {
    expect(readWorkflowCascadeConfig(null)).toEqual({
      followOnActions: [],
      cascadePolicy: "immediate",
      maxCascadeDepth: 3,
      currentDepth: 0,
      targetContactIds: undefined,
    });
  });

  it("reads and clamps custom cascade config with multi-actions", () => {
    const config = readWorkflowCascadeConfig({
      followOnActions: ["profile_pipeline", "contact_nurture"],
      cascadePolicy: "supervised",
      maxCascadeDepth: 10, // should clamp to 5
      currentDepth: -2, // should clamp to 0
      targetContactIds: ["c1", "c2", "  "],
    });

    expect(config).toEqual({
      followOnActions: ["profile_pipeline", "contact_nurture"],
      cascadePolicy: "supervised",
      maxCascadeDepth: 5,
      currentDepth: 0,
      targetContactIds: ["c1", "c2"],
    });
  });

  it("resolves follow-on templates correctly", () => {
    createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
    });

    const template = resolveFollowOnTemplate("profile_pipeline");
    expect(template).not.toBeNull();
    expect(template?.name).toBe("Contact profile pipeline");
  });

  it("dispatches deterministic cascade run to multiple child workflows", () => {
    const t1 = createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
    });

    const t2 = createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: t1.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["profile_pipeline", "contact_nurture"],
          cascadePolicy: "immediate",
          currentDepth: 0,
          maxCascadeDepth: 3,
        }),
      }),
    });

    const result = dispatchWorkflowCascade({
      parentRunId: parentRun.id,
      createdContactIds: ["c_101", "c_102"],
    });

    expect(result.triggered).toBe(true);
    expect(result.childRunIds).toHaveLength(2);
    expect(result.targetTemplateNames).toContain("Contact profile pipeline");
    expect(result.targetTemplateNames).toContain("Contact Relationship Nurture");
    expect(result.followOnActions).toEqual(["profile_pipeline", "contact_nurture"]);
  });

  it("handles agentic_router without spawning child run directly", () => {
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

    const result = dispatchWorkflowCascade({
      parentRunId: parentRun.id,
      createdContactIds: ["c_201"],
    });

    expect(result.triggered).toBe(true);
    expect(result.followOnAction).toBe("agentic_router");
    expect(result.childRunIds).toBeUndefined();
  });

  it("enforces maxCascadeDepth to prevent infinite recursion", () => {
    const template = createTemplate({
      name: "Social Intent Patrol",
      templateType: "engagement",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["social_patrol"],
          currentDepth: 3,
          maxCascadeDepth: 3,
        }),
      }),
    });

    const result = dispatchWorkflowCascade({
      parentRunId: parentRun.id,
      createdContactIds: ["c_301"],
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain("Max cascade depth (3) reached");
  });
});
