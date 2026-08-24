import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowTemplates } from "@/lib/db/schema";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import type { WorkflowTemplate } from "@/lib/db/types";
import type { WorkflowType } from "@/lib/workflows/types";
import {
  CASCADE_CONFIG_KEY,
  FOLLOW_ON_ACTION_OPTIONS,
  MAX_CASCADE_DEPTH_DEFAULT,
  buildWorkflowCascadeConfig,
  readWorkflowCascadeConfig,
  type FollowOnActionType,
  type WorkflowCascadeConfig,
} from "@/lib/workflows/cascade-types";

export * from "@/lib/workflows/cascade-types";

export function mapTemplateTypeToWorkflowType(templateType: string): WorkflowType {
  switch (templateType) {
    case "prospecting":
      return "search";
    case "enrichment":
      return "enrich";
    case "pruning":
      return "prune";
    default:
      return "agent";
  }
}

export function resolveFollowOnTemplate(action: FollowOnActionType): WorkflowTemplate | null {
  const option = FOLLOW_ON_ACTION_OPTIONS.find((opt) => opt.value === action);
  if (!option?.targetTemplateName) return null;

  return (
    db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.name, option.targetTemplateName))
      .get() ?? null
  );
}

export interface DispatchCascadeInput {
  parentRunId: string;
  createdContactIds: string[];
  overrideAction?: FollowOnActionType;
}

export interface DispatchCascadeResult {
  triggered: boolean;
  childRunId?: string;
  targetTemplateName?: string;
  followOnAction: FollowOnActionType;
  reason?: string;
}

/**
 * Executes a deterministic or agentic workflow cascade upon parent workflow completion.
 */
export function dispatchWorkflowCascade(input: DispatchCascadeInput): DispatchCascadeResult {
  const parentRun = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, input.parentRunId))
    .get();

  if (!parentRun) {
    return { triggered: false, followOnAction: "none", reason: "Parent workflow run not found" };
  }

  const rawParentConfig = JSON.parse(parentRun.config ?? "{}") as Record<string, unknown>;
  const cascadeConfig = readWorkflowCascadeConfig(rawParentConfig);
  const actionToExecute = input.overrideAction ?? cascadeConfig.followOnAction;

  if (actionToExecute === "none") {
    return { triggered: false, followOnAction: "none", reason: "No follow-on action configured" };
  }

  if (actionToExecute === "agentic_router") {
    return {
      triggered: true,
      followOnAction: "agentic_router",
      reason: "Routed to agentic webhook orchestrator",
    };
  }

  const currentDepth = cascadeConfig.currentDepth ?? 0;
  const maxCascadeDepth = cascadeConfig.maxCascadeDepth ?? MAX_CASCADE_DEPTH_DEFAULT;

  if (currentDepth >= maxCascadeDepth) {
    return {
      triggered: false,
      followOnAction: actionToExecute,
      reason: `Max cascade depth (${maxCascadeDepth}) reached`,
    };
  }

  const targetTemplate = resolveFollowOnTemplate(actionToExecute);
  if (!targetTemplate) {
    return {
      triggered: false,
      followOnAction: actionToExecute,
      reason: `Target template for ${actionToExecute} not found`,
    };
  }

  // Inherit template config, attach target contact IDs and increment depth
  const templateConfig = JSON.parse(targetTemplate.config ?? "{}") as Record<string, unknown>;
  const childConfig = {
    ...templateConfig,
    parentWorkflowId: parentRun.id,
    targetContactIds: input.createdContactIds,
    [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
      followOnAction: "none", // Prevent uncontrolled chain loops on child unless specified
      currentDepth: currentDepth + 1,
      maxCascadeDepth,
      targetContactIds: input.createdContactIds,
    }),
  };

  const childRun = createWorkflowRun({
    templateId: targetTemplate.id,
    workflowType: mapTemplateTypeToWorkflowType(targetTemplate.templateType),
    status: "pending",
    trigger: "template",
    parentWorkflowId: parentRun.id,
    config: JSON.stringify(childConfig),
  });

  return {
    triggered: true,
    childRunId: childRun.id,
    targetTemplateName: targetTemplate.name,
    followOnAction: actionToExecute,
  };
}
