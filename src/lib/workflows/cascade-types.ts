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
