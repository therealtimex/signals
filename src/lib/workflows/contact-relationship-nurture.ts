/**
 * "Contact Relationship Nurture" — a relationship progression workflow executed in the Terminal
 * Agent lane.
 *
 * It queries active CRM contacts with assigned relationship goals (follow_back,
 * repost_amplification, mutual_engagement, warm_conversation, partnership), observes live social
 * streams for milestones, and proposes persona-grounded touchpoints.
 *
 * Since #410 it does not author prose from its own instructions. Every touchpoint is a
 * `WritingIntent` handed to the shared writing pipeline (`writing-composition.ts`), which owns
 * Personality voice, target gates, audit, explicit approval, materialization, and lineage. The
 * mandate is `assist_only` (#377): draft, audit, propose — never publish, comment, reply, or send.
 */

import {
  clampSlider,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";
import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_LABELS,
  type RelationshipGoal,
} from "@/lib/relationship-goals";
import { parseSurfaceId, type SurfaceId } from "@/lib/writing/surfaces";
import { NURTURE_WRITING_SURFACES } from "@/lib/writing/writing-intent";
import { buildWritingIntentCompositionConfig } from "@/lib/workflows/writing-composition";
import type { WritingGoal } from "@/lib/workflows/signals-writing";

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

/**
 * How a relationship goal becomes a writing surface.
 *
 * Every entry lands on a send-less surface: an assist-only workflow proposes, so a publish-capable
 * spotlight post is deliberately absent (a repost ask is earned in a comment here).
 */
export const NURTURE_TOUCHPOINT_PLAN: Record<
  RelationshipGoal,
  { surfaceKind: "comment" | "direct_message"; writingGoal: WritingGoal; deliverable: string }
> = {
  follow_back: {
    surfaceKind: "comment",
    writingGoal: "follows",
    deliverable: "a high-signal comment on their recent post that earns the follow back",
  },
  repost_amplification: {
    surfaceKind: "comment",
    writingGoal: "reposts",
    deliverable: "a comment that gives them a reason to amplify our work",
  },
  mutual_engagement: {
    surfaceKind: "comment",
    writingGoal: "replies",
    deliverable: "an authoritative answer or perspective on their active discussion",
  },
  warm_conversation: {
    surfaceKind: "direct_message",
    writingGoal: "replies",
    deliverable: "a draft-only direct message referencing a real public interaction",
  },
  partnership: {
    surfaceKind: "direct_message",
    writingGoal: "leads",
    deliverable: "a draft-only partnership proposal grounded in allowlisted evidence",
  },
};

/** The writing surface for an acting platform and touchpoint kind, or null when unsupported. */
export function resolveNurtureSurface(
  platform: string,
  surfaceKind: "comment" | "direct_message",
): SurfaceId | null {
  const surface = parseSurfaceId(
    `${platform.toLowerCase()}/${surfaceKind === "comment" && platform.toLowerCase() === "x" ? "reply" : surfaceKind}`,
  );
  return surface && (NURTURE_WRITING_SURFACES as readonly SurfaceId[]).includes(surface)
    ? surface
    : null;
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

/**
 * The writing-intent opt-in nurture carries.
 *
 * Kept as its own export so `seedTemplates` can merge it into an existing install's config without
 * clobbering operator-tuned sliders.
 */
export function buildContactNurtureWritingComposition(): Record<string, unknown> {
  return buildWritingIntentCompositionConfig({ consumer: "contact_relationship_nurture" });
}

export function buildContactNurtureRunConfig(
  config: ContactNurtureConfig,
): Record<string, unknown> {
  return {
    [CONTACT_NURTURE_CONFIG_KEY]: { version: CONTACT_NURTURE_CONFIG_VERSION },
    ...buildContactNurtureWritingComposition(),
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
    ...buildContactNurtureWritingComposition(),
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

  const goalsInScope = (nurture.relationshipGoalFilter === "all"
    ? RELATIONSHIP_GOAL_ENUM
    : [nurture.relationshipGoalFilter]) as readonly RelationshipGoal[];

  const touchpointRows = goalsInScope.map((goal) => {
    const plan = NURTURE_TOUCHPOINT_PLAN[goal];
    const surface = resolveNurtureSurface(targetPlatform, plan.surfaceKind);
    return surface
      ? `    - ${goal} (${RELATIONSHIP_GOAL_LABELS[goal]}): surface=${surface}, writingGoal=${plan.writingGoal} — propose ${plan.deliverable}.`
      : `    - ${goal} (${RELATIONSHIP_GOAL_LABELS[goal]}): no ${plan.surfaceKind} surface on ${targetPlatform} — report it as unsupported and skip.`;
  });

  const lines = [
    "Contact Relationship Nurture execution contract:",
    `N0. Goal filter: ${goalText}. Max targets to inspect: ${nurture.maxTargets}. Max touchpoint proposals: ${nurture.maxActionsPerRun}.`,
    `    Acting Profile: ${targetName}. Active Platform: ${targetPlatform}.`,
    "    Mandate: assist_only. This workflow drafts, audits, and proposes. It never publishes, comments, replies, sends a message, opens a publish job, or schedules one.",
    `N1. Query unachieved contacts via query_contacts({ relationshipGoalStatus: "not_started" }) and query_contacts({ relationshipGoalStatus: "in_progress" }).`,
    "N2. For each contact, call get_contact({ contactId }) for recipient context — persona, conversion triggers, tone, platform. This answers \"who is receiving and what is relevant\"; it never answers \"who is speaking\" and never becomes a fact in the artifact.",
    isLinkedIn
      ? "N3. Observe only: inspect the contact's live LinkedIn profile / post stream for milestone achievements. Read, never interact."
      : isFacebook
        ? "N3. Observe only: inspect the contact's Facebook profile / activity stream for milestone achievements. Read, never interact."
        : "N3. Observe only: inspect the contact's live social stream for milestone achievements. Read, never interact.",
    nurture.autoAchieveOnMilestone
      ? isLinkedIn
        ? "    Auto-achieve is ON: If contact is now connected / following the acting profile or reposted our content, immediately call update_contact({ contactId, relationshipGoalStatus: \"achieved\" }) and record milestone."
        : "    Auto-achieve is ON: If contact is now following the acting profile or reposted our content, immediately call update_contact({ contactId, relationshipGoalStatus: \"achieved\" }) and record milestone."
      : "    Auto-achieve is OFF: Log observed milestone in thread for operator review.",
    "N4. Touchpoint proposals — emit one writing intent per contact and follow the shared writing-intent contract below. Do not draft prose from these instructions:",
    ...touchpointRows,
    "    For each intent set `recipient` to the contact reference, `goal.id` to the relationship goal, `target` to the acting profile above, and `sourceRefs` to the allowlisted evidence you actually read. Attach the intent as `metadata.writing.intent` on upsert_variant.",
    "    Personality is the speaker; the contact is the recipient. Never write contact facts, persona attributes, relationship notes, or private CRM fields into IDENTITY.md, SOUL.md, VOICE.md, or BRAND.md.",
    nurture.requireApproval
      ? "N5. Approval gate: present proposals in this thread in batches of 3–5 and wait for explicit operator approval before calling materialize_variant. `auto_low_risk` does not apply to nurture proposals."
      : "N5. Approval gate: explicit user approval is still required for every nurture proposal — the assist-only mandate outranks this run control, and Signals rejects a policy approval on these artifacts.",
    "N6. A refused intent is a result, not a failure: report the persisted Personality status, capability, or target reason and move on. Never repair drift by editing Personality files.",
    "N7. WRITE-BACK TO SIGNALS (record every proposal):",
    `    a. The approved, materialized proposal is the content record — materialize_variant owns that boundary. Do not POST ${input.signalsBaseUrl}/api/content for a proposal, and never mark one published.`,
    `    b. Log the proposed touchpoint in Signals via:`,
    `       POST ${input.signalsBaseUrl}/api/agent-tools/invoke with JSON:`,
    `       { "tool": "log_interaction", "input": { "contactId": "<contactId>", "interactionType": "${isLinkedIn ? "linkedin_comment" : isFacebook ? "facebook_post" : "reply"}", "summary": "<proposed touchpoint, variant id, and approval state>" } }`,
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
