export type FollowOnActionType =
  | "profile_pipeline"
  | "contact_nurture"
  | "social_patrol"
  | "agentic_router";

export interface WorkflowCascadeConfig {
  followOnActions: FollowOnActionType[];
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
  badge: string;
  description: string;
  targetTemplateName?: string;
}> = [
  {
    value: "profile_pipeline",
    badge: "⚡",
    label: "Contact Profile Pipeline (Hydrate & Persona)",
    description: "Automatically hydrate bios, avatars, and AI personas for newly discovered contacts.",
    targetTemplateName: "Contact profile pipeline",
  },
  {
    value: "contact_nurture",
    badge: "🤝",
    label: "Contact Relationship Nurture",
    description: "Queue follow and warm engagement actions on X/LinkedIn for discovered contacts.",
    targetTemplateName: "Contact Relationship Nurture",
  },
  {
    value: "social_patrol",
    badge: "🎯",
    label: "Social Intent Patrol",
    description: "Monitor discovered founders and investors for active launch and product discussions.",
    targetTemplateName: "Social Intent Patrol",
  },
  {
    value: "agentic_router",
    badge: "🤖",
    label: "Smart Agentic Routing (Webhook / Orchestrator)",
    description: "Post a workflow.completed webhook for the RealTimeX Orchestrator agent to inspect the cohort and dynamically dispatch the next step.",
  },
];

const VALID_ACTION_SET = new Set<string>(FOLLOW_ON_ACTION_OPTIONS.map((opt) => opt.value));

export function readWorkflowCascadeConfig(rawConfig: Record<string, unknown> | null | undefined): WorkflowCascadeConfig {
  if (!rawConfig) {
    return {
      followOnActions: [],
      cascadePolicy: "immediate",
      maxCascadeDepth: MAX_CASCADE_DEPTH_DEFAULT,
      currentDepth: 0,
    };
  }

  const cascade = (rawConfig[CASCADE_CONFIG_KEY] as Record<string, unknown> | undefined) ?? rawConfig;

  let followOnActions: FollowOnActionType[] = [];
  if (Array.isArray(cascade.followOnActions)) {
    followOnActions = cascade.followOnActions.filter((act): act is FollowOnActionType =>
      typeof act === "string" && VALID_ACTION_SET.has(act)
    );
  } else if (typeof cascade.followOnAction === "string" && VALID_ACTION_SET.has(cascade.followOnAction)) {
    followOnActions = [cascade.followOnAction as FollowOnActionType];
  }

  const cascadePolicy = cascade.cascadePolicy === "supervised" ? "supervised" : "immediate";

  const rawMaxDepth = typeof cascade.maxCascadeDepth === "number" ? cascade.maxCascadeDepth : MAX_CASCADE_DEPTH_DEFAULT;
  const maxCascadeDepth = Math.max(1, Math.min(5, Math.floor(rawMaxDepth)));

  const rawCurrentDepth = typeof cascade.currentDepth === "number" ? cascade.currentDepth : 0;
  const currentDepth = Math.max(0, Math.floor(rawCurrentDepth));

  const targetContactIds = Array.isArray(cascade.targetContactIds)
    ? cascade.targetContactIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : undefined;

  return {
    followOnActions,
    cascadePolicy,
    maxCascadeDepth,
    currentDepth,
    targetContactIds,
  };
}

export function buildWorkflowCascadeConfig(config: Partial<WorkflowCascadeConfig>): Record<string, unknown> {
  const followOnActions = config.followOnActions ?? [];
  return {
    followOnActions,
    followOnAction: followOnActions[0] ?? "none", // Legacy compatibility
    cascadePolicy: config.cascadePolicy ?? "immediate",
    maxCascadeDepth: config.maxCascadeDepth ?? MAX_CASCADE_DEPTH_DEFAULT,
    currentDepth: config.currentDepth ?? 0,
    ...(config.targetContactIds ? { targetContactIds: config.targetContactIds } : {}),
  };
}
