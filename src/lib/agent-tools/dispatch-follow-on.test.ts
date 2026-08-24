import { beforeEach, describe, expect, it } from "vitest";
import { resetCoreTables } from "@/test/db";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { handleDispatchFollowOnWorkflow } from "@/lib/agent-tools/handlers";
import { AGENT_TOOLS } from "@/lib/agent-tools/registry";

describe("dispatch_follow_on_workflow Agent Tool", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("is registered in AGENT_TOOLS manifest", () => {
    expect(AGENT_TOOLS.dispatch_follow_on_workflow).toBeDefined();
    expect(AGENT_TOOLS.dispatch_follow_on_workflow.category).toBe("workflows");
  });

  it("triggers follow-on workflow cascade via agent tool", async () => {
    const template = createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
    });

    const result = await handleDispatchFollowOnWorkflow({
      parentWorkflowRunId: parentRun.id,
      followOnAction: "profile_pipeline",
      contactIds: ["c_401", "c_402"],
    });

    expect(result.success).toBe(true);
    expect(result.childRunId).toBeDefined();
    expect(result.targetTemplateName).toBe("Contact profile pipeline");
  });
});
