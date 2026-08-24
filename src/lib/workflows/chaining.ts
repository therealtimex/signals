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
  overrideActions?: FollowOnActionType[];
  // Legacy single action alias
  overrideAction?: FollowOnActionType;
}

export interface DispatchCascadeResult {
  triggered: boolean;
  childRunIds?: string[];
  childRunId?: string;
  targetTemplateNames?: string[];
  targetTemplateName?: string;
  followOnActions: FollowOnActionType[];
  followOnAction?: FollowOnActionType;
  reason?: string;
}

/**
 * Executes a deterministic or agentic workflow cascade upon parent workflow completion.
 * Supports multiple follow-on workflows simultaneously.
 */
export function dispatchWorkflowCascade(input: DispatchCascadeInput): DispatchCascadeResult {
  const parentRun = db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, input.parentRunId))
    .get();

  if (!parentRun) {
    return { triggered: false, followOnActions: [], reason: "Parent workflow run not found" };
  }

  const rawParentConfig = JSON.parse(parentRun.config ?? "{}") as Record<string, unknown>;
  const cascadeConfig = readWorkflowCascadeConfig(rawParentConfig);
  const actionsToExecute = input.overrideActions ?? (input.overrideAction ? [input.overrideAction] : cascadeConfig.followOnActions);

  if (actionsToExecute.length === 0) {
    return { triggered: false, followOnActions: [], reason: "No follow-on action configured" };
  }

  const currentDepth = cascadeConfig.currentDepth ?? 0;
  const maxCascadeDepth = cascadeConfig.maxCascadeDepth ?? MAX_CASCADE_DEPTH_DEFAULT;

  if (currentDepth >= maxCascadeDepth) {
    return {
      triggered: false,
      followOnActions: actionsToExecute,
      reason: `Max cascade depth (${maxCascadeDepth}) reached`,
    };
  }

  if (actionsToExecute.includes("agentic_router")) {
    return {
      triggered: true,
      followOnActions: actionsToExecute,
      followOnAction: "agentic_router",
      reason: "Routed to agentic webhook orchestrator",
    };
  }

  const childRunIds: string[] = [];
  const targetTemplateNames: string[] = [];

  for (const action of actionsToExecute) {
    const targetTemplate = resolveFollowOnTemplate(action);
    if (!targetTemplate) continue;

    const templateConfig = JSON.parse(targetTemplate.config ?? "{}") as Record<string, unknown>;
    const childConfig = {
      ...templateConfig,
      parentWorkflowId: parentRun.id,
      targetContactIds: input.createdContactIds,
      [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
        followOnActions: [], // Prevent uncontrolled recursive fan-out on child
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

    childRunIds.push(childRun.id);
    targetTemplateNames.push(targetTemplate.name);
  }

  if (childRunIds.length === 0) {
    return {
      triggered: false,
      followOnActions: actionsToExecute,
      reason: "Could not resolve templates for specified actions",
    };
  }

  return {
    triggered: true,
    childRunIds,
    childRunId: childRunIds[0],
    targetTemplateNames,
    targetTemplateName: targetTemplateNames[0],
    followOnActions: actionsToExecute,
    followOnAction: actionsToExecute[0],
  };
}
