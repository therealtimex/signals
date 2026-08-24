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
      followOnAction: "none",
      cascadePolicy: "immediate",
      maxCascadeDepth: 3,
      currentDepth: 0,
      targetContactIds: undefined,
    });
  });

  it("reads and clamps custom cascade config", () => {
    const config = readWorkflowCascadeConfig({
      followOnAction: "profile_pipeline",
      cascadePolicy: "supervised",
      maxCascadeDepth: 10, // should clamp to 5
      currentDepth: -2, // should clamp to 0
      targetContactIds: ["c1", "c2", "  "],
    });

    expect(config).toEqual({
      followOnAction: "profile_pipeline",
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

  it("dispatches deterministic cascade run to child workflow", () => {
    const template = createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
      config: JSON.stringify({ followBack: true }),
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnAction: "contact_nurture",
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
    expect(result.childRunId).toBeDefined();
    expect(result.targetTemplateName).toBe("Contact Relationship Nurture");
    expect(result.followOnAction).toBe("contact_nurture");
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
          followOnAction: "agentic_router",
        }),
      }),
    });

    const result = dispatchWorkflowCascade({
      parentRunId: parentRun.id,
      createdContactIds: ["c_201"],
    });

    expect(result.triggered).toBe(true);
    expect(result.followOnAction).toBe("agentic_router");
    expect(result.childRunId).toBeUndefined();
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
          followOnAction: "social_patrol",
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
