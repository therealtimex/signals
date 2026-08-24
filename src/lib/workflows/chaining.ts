import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowTemplates } from "@/lib/db/schema";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import type { WorkflowTemplate } from "@/lib/db/types";
import type { WorkflowType } from "@/lib/workflows/types";

export type FollowOnActionType =
  | "none"
  | "profile_pipeline"
  | "contact_nurture"
  | "social_patrol"
  | "agentic_router";

export interface WorkflowCascadeConfig {
  followOnAction: FollowOnActionType;
  cascadePolicy?: "immediate" | "supervised";
  maxCascadeDepth?: number;
  currentDepth?: number;
  targetContactIds?: string[];
}

export const CASCADE_CONFIG_KEY = "cascadeConfig";
export const MAX_CASCADE_DEPTH_DEFAULT = 3;

export const FOLLOW_ON_ACTION_OPTIONS: Array<{
  value: FollowOnActionType;
  label: string;
  description: string;
  targetTemplateName?: string;
}> = [
  {
    value: "none",
    label: "None (Single run only)",
    description: "Conclude after this workflow completes without follow-on actions.",
  },
  {
    value: "profile_pipeline",
    label: "⚡ Contact Profile Pipeline (Hydrate & Persona)",
    description: "Automatically hydrate bios, avatars, and AI personas for newly discovered contacts.",
    targetTemplateName: "Contact profile pipeline",
  },
  {
    value: "contact_nurture",
    label: "🤝 Contact Relationship Nurture",
    description: "Queue follow and warm engagement actions on X/LinkedIn for discovered contacts.",
    targetTemplateName: "Contact Relationship Nurture",
  },
  {
    value: "social_patrol",
    label: "🎯 Social Intent Patrol",
    description: "Monitor discovered founders and investors for active launch and product discussions.",
    targetTemplateName: "Social Intent Patrol",
  },
  {
    value: "agentic_router",
    label: "🤖 Smart Agentic Routing (Webhook / Orchestrator)",
    description: "Post a workflow.completed webhook for the RealTimeX Orchestrator agent to inspect the cohort and dynamically dispatch the next step.",
  },
];

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

export function readWorkflowCascadeConfig(rawConfig: Record<string, unknown> | null | undefined): WorkflowCascadeConfig {
  if (!rawConfig) {
    return {
      followOnAction: "none",
      cascadePolicy: "immediate",
      maxCascadeDepth: MAX_CASCADE_DEPTH_DEFAULT,
      currentDepth: 0,
    };
  }

  const cascade = (rawConfig[CASCADE_CONFIG_KEY] as Record<string, unknown> | undefined) ?? rawConfig;

  const followOnAction =
    typeof cascade.followOnAction === "string" &&
    FOLLOW_ON_ACTION_OPTIONS.some((opt) => opt.value === cascade.followOnAction)
      ? (cascade.followOnAction as FollowOnActionType)
      : "none";

  const cascadePolicy = cascade.cascadePolicy === "supervised" ? "supervised" : "immediate";

  const rawMaxDepth = typeof cascade.maxCascadeDepth === "number" ? cascade.maxCascadeDepth : MAX_CASCADE_DEPTH_DEFAULT;
  const maxCascadeDepth = Math.max(1, Math.min(5, Math.floor(rawMaxDepth)));

  const rawCurrentDepth = typeof cascade.currentDepth === "number" ? cascade.currentDepth : 0;
  const currentDepth = Math.max(0, Math.floor(rawCurrentDepth));

  const targetContactIds = Array.isArray(cascade.targetContactIds)
    ? cascade.targetContactIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : undefined;

  return {
    followOnAction,
    cascadePolicy,
    maxCascadeDepth,
    currentDepth,
    targetContactIds,
  };
}

export function buildWorkflowCascadeConfig(config: Partial<WorkflowCascadeConfig>): Record<string, unknown> {
  return {
    followOnAction: config.followOnAction ?? "none",
    cascadePolicy: config.cascadePolicy ?? "immediate",
    maxCascadeDepth: config.maxCascadeDepth ?? MAX_CASCADE_DEPTH_DEFAULT,
    currentDepth: config.currentDepth ?? 0,
    ...(config.targetContactIds ? { targetContactIds: config.targetContactIds } : {}),
  };
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
