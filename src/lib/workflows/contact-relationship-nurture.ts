/**
 * "Contact Relationship Nurture" — an autonomous relationship progression workflow executed in the Terminal Agent lane.
 *
 * It queries active CRM contacts with assigned relationship goals (follow_back, repost_amplification,
 * mutual_engagement, warm_conversation, partnership), applies persona-grounded tactics, inspects live
 * social streams, executes high-signal touchpoints with salted pacing delays, and syncs goal milestones.
 */

import {
  clampSlider,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";
import {
  RELATIONSHIP_GOAL_ENUM,
  type RelationshipGoal,
} from "@/lib/relationship-goals";

export const CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME = "Contact Relationship Nurture";

/** Marker key in template config. */
export const CONTACT_NURTURE_CONFIG_KEY = "contactNurture";

export const CONTACT_NURTURE_CONFIG_VERSION = 1;

export type ContactNurtureSliderKey =
  | "maxTargets"
  | "maxActionsPerRun"
  | "delayBetweenActionsSeconds";

export const CONTACT_NURTURE_SLIDERS: Record<ContactNurtureSliderKey, SliderBounds> = {
  maxTargets: { min: 1, max: 50, step: 1, fallback: 10 },
  maxActionsPerRun: { min: 1, max: 20, step: 1, fallback: 5 },
  delayBetweenActionsSeconds: { min: 15, max: 60, step: 5, fallback: 30 },
};

export interface ContactNurtureConfig {
  /** `platform_targets.id` of the acting profile, or null. */
  targetId: string | null;
  relationshipGoalFilter: "all" | RelationshipGoal;
  maxTargets: number;
  maxActionsPerRun: number;
  delayBetweenActionsSeconds: number;
  requireApproval: boolean;
  autoAchieveOnMilestone: boolean;
}

export function isContactNurtureTemplateConfig(config: Record<string, unknown>): boolean {
  return Boolean(config[CONTACT_NURTURE_CONFIG_KEY]);
}

export function clampContactNurtureSlider(key: ContactNurtureSliderKey, value: unknown): number {
  return clampSlider(CONTACT_NURTURE_SLIDERS[key], value);
}

export function readContactNurtureConfig(config: Record<string, unknown>): ContactNurtureConfig {
  const goalFilter = typeof config.relationshipGoalFilter === "string" &&
    (config.relationshipGoalFilter === "all" || (RELATIONSHIP_GOAL_ENUM as readonly string[]).includes(config.relationshipGoalFilter))
    ? (config.relationshipGoalFilter as "all" | RelationshipGoal)
    : "all";

  return {
    targetId: typeof config.targetId === "string" && config.targetId.trim()
      ? config.targetId.trim()
      : null,
    relationshipGoalFilter: goalFilter,
    maxTargets: clampContactNurtureSlider("maxTargets", config.maxTargets),
    maxActionsPerRun: clampContactNurtureSlider("maxActionsPerRun", config.maxActionsPerRun),
    delayBetweenActionsSeconds: clampContactNurtureSlider(
      "delayBetweenActionsSeconds",
      config.delayBetweenActionsSeconds,
    ),
    requireApproval: typeof config.requireApproval === "boolean" ? config.requireApproval : true,
    autoAchieveOnMilestone: typeof config.autoAchieveOnMilestone === "boolean" ? config.autoAchieveOnMilestone : true,
  };
}

export function buildContactNurtureRunConfig(
  config: ContactNurtureConfig,
): Record<string, unknown> {
  return {
    [CONTACT_NURTURE_CONFIG_KEY]: { version: CONTACT_NURTURE_CONFIG_VERSION },
    targetId: config.targetId,
    relationshipGoalFilter: config.relationshipGoalFilter,
    maxTargets: clampContactNurtureSlider("maxTargets", config.maxTargets),
    maxActionsPerRun: clampContactNurtureSlider("maxActionsPerRun", config.maxActionsPerRun),
    delayBetweenActionsSeconds: clampContactNurtureSlider(
      "delayBetweenActionsSeconds",
      config.delayBetweenActionsSeconds,
    ),
    requireApproval: config.requireApproval,
    autoAchieveOnMilestone: config.autoAchieveOnMilestone,
  };
}

export function buildContactNurtureTemplateConfig(
  overrides?: Partial<ContactNurtureConfig>,
): Record<string, unknown> {
  const defaults: ContactNurtureConfig = {
    targetId: null,
    relationshipGoalFilter: "all",
    maxTargets: CONTACT_NURTURE_SLIDERS.maxTargets.fallback,
    maxActionsPerRun: CONTACT_NURTURE_SLIDERS.maxActionsPerRun.fallback,
    delayBetweenActionsSeconds: CONTACT_NURTURE_SLIDERS.delayBetweenActionsSeconds.fallback,
    requireApproval: true,
    autoAchieveOnMilestone: true,
  };

  return {
    [CONTACT_NURTURE_CONFIG_KEY]: CONTACT_NURTURE_CONFIG_VERSION,
    ...defaults,
    ...(overrides ?? {}),
  };
}

export interface ContactNurtureTargetInfo {
  id: string;
  platform: string;
  name: string;
  handle?: string | null;
}

export function buildContactNurtureBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
  signalsBaseUrl: string;
  platformTarget?: ContactNurtureTargetInfo | null;
}): string {
  const nurture = readContactNurtureConfig(input.config);
  const goalText = nurture.relationshipGoalFilter === "all"
    ? "All assigned relationship goals (follow_back, repost_amplification, mutual_engagement, warm_conversation, partnership)"
    : `Only "${nurture.relationshipGoalFilter}" goals`;

  const targetPlatform = (
    input.platformTarget?.platform ||
    (typeof input.config.targetPlatform === "string" ? input.config.targetPlatform : "") ||
    "x"
  ).toLowerCase();

  const isLinkedIn = targetPlatform === "linkedin";
  const isFacebook = targetPlatform === "facebook";
  const platformLabel = isLinkedIn ? "LinkedIn" : isFacebook ? "Facebook" : "X";

  const targetName = input.platformTarget
    ? `${platformLabel}: ${input.platformTarget.name || input.platformTarget.handle}${input.platformTarget.handle ? ` (${input.platformTarget.handle})` : ""} [ID: ${input.platformTarget.id}]`
    : (typeof input.config.targetName === "string"
        ? `${platformLabel}: ${input.config.targetName}${input.config.targetHandle ? ` (${input.config.targetHandle})` : ""}${nurture.targetId ? ` [ID: ${nurture.targetId}]` : ""}`
        : (nurture.targetId ? `Target ID: ${nurture.targetId}` : "Auto-detect default acting target per contact platform"));

  const defaultInteractionType = isLinkedIn ? "linkedin_comment" : isFacebook ? "facebook_post" : "reply";

  const lines = [
    "Contact Relationship Nurture execution contract:",
    `N0. Goal filter: ${goalText}. Max targets to inspect: ${nurture.maxTargets}. Max actions: ${nurture.maxActionsPerRun}.`,
    `    Acting Profile: ${targetName}. Active Platform: ${targetPlatform}.`,
    `N1. Query unachieved contacts via query_contacts({ relationshipGoalStatus: "not_started" }) and query_contacts({ relationshipGoalStatus: "in_progress" }).`,
    "N2. For each contact, call get_contact({ contactId }) to inspect their persona, conversion triggers, tone, and platform.",
    isLinkedIn
      ? "N3. Open RealTimeX Browser session for LinkedIn and inspect the contact's live profile / post stream to check for milestone achievements."
      : isFacebook
        ? "N3. Open RealTimeX Browser session for Facebook and inspect the contact's profile / activity stream to check for milestone achievements."
        : "N3. Open RealTimeX Browser session and inspect the contact's live social stream to check for milestone achievements.",
    nurture.autoAchieveOnMilestone
      ? isLinkedIn
        ? "    Auto-achieve is ON: If contact is now connected / following the acting profile or reposted our content, immediately call update_contact({ contactId, relationshipGoalStatus: \"achieved\" }) and record milestone."
        : "    Auto-achieve is ON: If contact is now following the acting profile or reposted our content, immediately call update_contact({ contactId, relationshipGoalStatus: \"achieved\" }) and record milestone."
      : "    Auto-achieve is OFF: Log observed milestone in thread for operator review.",
    "N4. Grounded tactical execution:",
    isLinkedIn
      ? "    - follow_back: Comment with high-signal domain value on recent post -> wait salted delay -> send connection request / follow."
      : "    - follow_back: Comment with high-signal technical value on recent post -> wait salted delay -> follow.",
    isLinkedIn
      ? "    - repost_amplification: Curate organic spotlight post / breakdown on LinkedIn mentioning them."
      : "    - repost_amplification: Curate organic spotlight post / breakdown tagging them.",
    isLinkedIn
      ? "    - mutual_engagement: Contribute authoritative answer or perspective on their active post discussions."
      : "    - mutual_engagement: Answer question or debate thread authoritatively.",
    isLinkedIn
      ? "    - warm_conversation: Send personalized LinkedIn message / InMail referencing public interaction."
      : "    - warm_conversation: Send personalized DM referencing public interaction.",
    "    - partnership: Stage co-marketing proposal brief.",
    `N5. Account Safety: Sleep ${nurture.delayBetweenActionsSeconds}s (with salted random variance) between consecutive posts/interactions.`,
    nurture.requireApproval
      ? "N6. Approval gate is ON: Present touchpoints/drafts in this thread in batches of 3–5 and wait for operator confirmation before publishing."
      : "N6. Approval gate is OFF: Execute touchpoints directly and log evidence in this thread.",
    "N7. MANDATORY WRITE-BACK TO SIGNALS (Record every action):",
    `    a. For any comment/reply or post published, write it to Signals Content immediately via:`,
    `       POST ${input.signalsBaseUrl}/api/content with JSON:`,
    `       { "body": "<published text>", "contentType": "reply", "status": "published", "origin": "authored", "direction": "outbound", "platformTarget": "${targetPlatform}", "platformUrl": "<url of published post/reply on ${platformLabel}>", "contactId": "<contactId>" }`,
    `    b. Log the interaction touchpoint in Signals via:`,
    `       POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON:`,
    `       { "tool": "log_interaction", "input": { "contactId": "<contactId>", "interactionType": "${defaultInteractionType}", "summary": "<description of action taken>" } }`,
    `    c. If target taskId is provided in config/brief, complete the task:`,
    `       POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON:`,
    `       { "tool": "update_task", "input": { "taskId": "<taskId>", "status": "done" } }`,
    `    d. Update contact relationship goal progress:`,
    `       POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON:`,
    `       { "tool": "update_contact", "input": { "contactId": "<contactId>", "relationshipGoalStatus": "in_progress" } }`,
    `N8. Attribute all created items to workflow run ${input.workflowRunId} and report summary with links in this thread.`,
  ];

  return lines.join("\n");
}
