/**
 * "Social Intent Patrol" — a time-boxed community-hunting shift executed in the Terminal Agent lane.
 *
 * The shift is outbound only: scan monitored communities, reply to pain posts, and capture the
 * people around them. Broadcasting to the acting profile's own timeline belongs to the
 * "Profile Publishing & Repost" template, not here.
 *
 * The slider bounds, defaults, and run-config shape live here so the activate dialog, the seed
 * template, and the launch brief cannot drift apart.
 */

import {
  clampSlider,
  normalizeTagList,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";

export const SOCIAL_INTENT_PATROL_TEMPLATE_NAME = "Social Intent Patrol";

/** Marker key in a template config that switches the activate dialog to the patrol form. */
export const SOCIAL_PATROL_CONFIG_KEY = "socialPatrol";

export const SOCIAL_PATROL_CONFIG_VERSION = 1;

/** Upper bound accepted by `prepare_platform_target` (src/lib/agent-tools/platform-target-handlers.ts). */
export const MAX_LEASE_TTL_SECONDS = 1800;

export type SocialPatrolSliderKey =
  | "durationMinutes"
  | "maxComments"
  | "maxScrapedContacts";

/** Anti-spam guardrails from the template contract — every value is operator-tunable per run. */
export const SOCIAL_PATROL_SLIDERS: Record<SocialPatrolSliderKey, SliderBounds> = {
  durationMinutes: { min: 5, max: 60, step: 5, fallback: 15 },
  maxComments: { min: 0, max: 5, step: 1, fallback: 2 },
  maxScrapedContacts: { min: 5, max: 50, step: 5, fallback: 20 },
};

export const DEFAULT_INTENT_KEYWORDS = [
  "recommend",
  "alternative",
  "token",
  "lỗi",
  "outgrowing",
];

export interface SocialPatrolConfig {
  /** `platform_targets.id` of the acting profile, or null while the operator has not picked one. */
  targetId: string | null;
  durationMinutes: number;
  maxComments: number;
  maxScrapedContacts: number;
  /** Group names or feed URLs to patrol. */
  communities: string[];
  intentKeywords: string[];
  /** Ask in the terminal thread before publishing any comment. */
  requireApproval: boolean;
}

export function isSocialPatrolTemplateConfig(config: Record<string, unknown>): boolean {
  return Boolean(config[SOCIAL_PATROL_CONFIG_KEY]);
}

export function clampSocialPatrolSlider(key: SocialPatrolSliderKey, value: unknown): number {
  return clampSlider(SOCIAL_PATROL_SLIDERS[key], value);
}

/**
 * A shift can outlast the maximum lease, so the TTL is the shift length capped at the
 * `prepare_platform_target` ceiling. Longer shifts renew the lease instead of asking for a
 * TTL the tool would reject.
 */
export function socialPatrolLeaseTtlSeconds(durationMinutes: number): number {
  const clamped = clampSocialPatrolSlider("durationMinutes", durationMinutes);
  return Math.min(clamped * 60, MAX_LEASE_TTL_SECONDS);
}

/**
 * Read stored template/run config into a fully-populated, in-range patrol config.
 *
 * An empty `intentKeywords` list is preserved rather than back-filled with the defaults: the
 * seeded template already carries them explicitly, so the only way to reach empty is an operator
 * clearing every pill. Re-injecting defaults here would make the brief contradict the runtime
 * config block it ships alongside.
 */
export function readSocialPatrolConfig(config: Record<string, unknown>): SocialPatrolConfig {
  return {
    targetId: typeof config.targetId === "string" && config.targetId.trim()
      ? config.targetId.trim()
      : null,
    durationMinutes: clampSocialPatrolSlider("durationMinutes", config.durationMinutes),
    maxComments: clampSocialPatrolSlider("maxComments", config.maxComments),
    maxScrapedContacts: clampSocialPatrolSlider(
      "maxScrapedContacts",
      config.maxScrapedContacts,
    ),
    communities: normalizeTagList(config.communities),
    intentKeywords: normalizeTagList(config.intentKeywords),
    // Approval stays on unless the operator explicitly turned it off.
    requireApproval: config.requireApproval !== false,
  };
}

/**
 * Build the `config` payload posted to `POST /api/workflows/templates/[id]/run`.
 * Re-clamps the draft so a hand-edited or stale dialog state cannot widen the guardrails.
 */
export function buildSocialPatrolRunConfig(
  draft: SocialPatrolConfig,
): Record<string, unknown> {
  const durationMinutes = clampSocialPatrolSlider("durationMinutes", draft.durationMinutes);
  return {
    targetId: draft.targetId?.trim() || null,
    durationMinutes,
    leaseTtlSeconds: socialPatrolLeaseTtlSeconds(durationMinutes),
    maxComments: clampSocialPatrolSlider("maxComments", draft.maxComments),
    maxScrapedContacts: clampSocialPatrolSlider(
      "maxScrapedContacts",
      draft.maxScrapedContacts,
    ),
    communities: normalizeTagList(draft.communities),
    intentKeywords: normalizeTagList(draft.intentKeywords),
    requireApproval: draft.requireApproval !== false,
  };
}

/** Default config stored on the seeded template. */
export function buildSocialPatrolTemplateConfig(): Record<string, unknown> {
  return {
    [SOCIAL_PATROL_CONFIG_KEY]: { version: SOCIAL_PATROL_CONFIG_VERSION },
    targetId: null,
    durationMinutes: SOCIAL_PATROL_SLIDERS.durationMinutes.fallback,
    maxComments: SOCIAL_PATROL_SLIDERS.maxComments.fallback,
    maxScrapedContacts: SOCIAL_PATROL_SLIDERS.maxScrapedContacts.fallback,
    communities: [],
    intentKeywords: [...DEFAULT_INTENT_KEYWORDS],
    requireApproval: true,
  };
}

/**
 * Run-config keys this template no longer understands. Installs seeded before the shift dropped
 * personal-profile posting still carry them, and `mergeRunConfig` would forward the stale value
 * into the brief's runtime block where an agent could read it as a live budget.
 */
export const RETIRED_SOCIAL_PATROL_CONFIG_KEYS = ["maxPosts"] as const;

/** Drop retired keys from a stored patrol config, returning null when nothing changed. */
export function stripRetiredSocialPatrolConfigKeys(
  config: Record<string, unknown>,
): Record<string, unknown> | null {
  const retired = RETIRED_SOCIAL_PATROL_CONFIG_KEYS.filter((key) => key in config);
  if (retired.length === 0) return null;
  const next = { ...config };
  for (const key of retired) delete next[key];
  return next;
}

/**
 * Execution contract appended to the launch brief. The terminal agent reads this instead of
 * inferring the lease/browser/write-back sequence from the run config alone.
 */
export function buildSocialPatrolBriefSection(input: {
  workflowRunId: string;
  config: Record<string, unknown>;
}): string {
  const patrol = readSocialPatrolConfig(input.config);
  const ttl = socialPatrolLeaseTtlSeconds(patrol.durationMinutes);
  const target = patrol.targetId ?? "<targetId>";
  const communities = patrol.communities.length > 0
    ? patrol.communities.join(", ")
    : "the acting profile's own feed (no communities configured)";
  // An empty keyword list is a deliberate operator choice, so say so rather than
  // reinstating defaults the runtime config block does not list.
  const keywordScope = patrol.intentKeywords.length > 0
    ? `Patrol these communities for intent keywords (${patrol.intentKeywords.join(", ")})`
    : "Patrol these communities with no keyword filter configured — use judgment on what counts as buying intent";

  const lines = [
    "Social Intent Patrol execution contract:",
    "P0. This shift is outbound only: lurk, reply in other people's threads, and capture engagers. Never publish, quote, or repost to the acting profile's own timeline — that is the \"Profile Publishing & Repost\" template's job.",
    `P1. Acquire the acting lease: signals-pp-cli targets prepare ${target} --intent browse --ttl ${ttl}`,
    `    Lease TTL is capped at ${MAX_LEASE_TTL_SECONDS}s — for a ${patrol.durationMinutes}-minute shift, renew with --lease <leaseId> instead of requesting a longer TTL.`,
    "P2. Connect over CDP to the RealTimeX Browser session named in the `sessionName` field of that prepare response (commonly `signals-publish`, but a target on a dedicated connection returns its own session — never assume). Confirm the live identity matches the returned `expectedHandle` before acting, and drive the platform through agent-browser, not agent-tools.",
    `P3. ${keywordScope}: ${communities}`,
    "    Scan the group/community feeds, the keyword search feeds, and the newest unanswered questions. Prefer posts where the author is stuck over posts that already have a good answer.",
    `P4. Stay inside the shift budget: at most ${patrol.maxComments} high-intent comment(s) and ${patrol.durationMinutes} minute(s) of wall clock.`,
    patrol.maxComments === 0
      ? "    maxComments is 0 — this is a scan-and-ingest-only shift. Read the communities and mine engagers, but do not reply to anything."
      : null,
    patrol.requireApproval
      ? "P5. Approval checkpoint is ON: post each drafted comment in this thread and wait for confirmation before publishing it."
      : "P5. Approval checkpoint is OFF: publish drafted comments directly, and log each one in this thread.",
    `P6. Mine engagers (likers and repliers) of the pain posts you engage with, up to ${patrol.maxScrapedContacts} contact(s).`,
    `P7. Write back: stage workflow-runs/${input.workflowRunId}/contacts.csv, then commit with`,
    `    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe`,
    "    Record every published reply as a Signals content_item attributed to this workflow run.",
    "P8. Release the lease when the shift ends: signals-pp-cli targets release --lease <leaseId>, then summarize comments and ingested contacts with links in this thread.",
  ];

  return lines.filter((line) => line !== null).join("\n");
}
