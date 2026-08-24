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
  | "maxComments"
  | "maxScrapedContacts";

/** Anti-spam guardrails from the template contract — every value is operator-tunable per run. */
export const SOCIAL_PATROL_SLIDERS: Record<SocialPatrolSliderKey, SliderBounds> = {
  maxComments: { min: 1, max: 100, step: 1, fallback: 5 },
  maxScrapedContacts: { min: 1, max: 100, step: 1, fallback: 20 },
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

/** Standard safe lease TTL for browser automation. Longer shifts renew before expiry. */
export function socialPatrolLeaseTtlSeconds(): number {
  return MAX_LEASE_TTL_SECONDS;
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
  return {
    targetId: draft.targetId?.trim() || null,
    leaseTtlSeconds: MAX_LEASE_TTL_SECONDS,
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
    maxComments: SOCIAL_PATROL_SLIDERS.maxComments.fallback,
    maxScrapedContacts: SOCIAL_PATROL_SLIDERS.maxScrapedContacts.fallback,
    communities: [],
    intentKeywords: [...DEFAULT_INTENT_KEYWORDS],
    requireApproval: true,
  };
}

/**
 * Run-config keys this template no longer understands. Installs seeded before the shift dropped
 * personal-profile posting or session duration still carry them, and `mergeRunConfig` would forward
 * the stale value into the brief's runtime block where an agent could read it as a live budget.
 */
export const RETIRED_SOCIAL_PATROL_CONFIG_KEYS = ["maxPosts", "durationMinutes"] as const;

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
  const ttl = MAX_LEASE_TTL_SECONDS;
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
    `    Lease TTL defaults to ${MAX_LEASE_TTL_SECONDS}s — for longer shifts, renew with --lease <leaseId> before the lease expires.`,
    "P2. Connect over CDP to the RealTimeX Browser session named in the `sessionName` field of that prepare response (commonly `signals-publish`, but a target on a dedicated connection returns its own session — never assume). Confirm the live identity matches the returned `expectedHandle` before acting, and drive the platform through agent-browser, not agent-tools.",
    `P3. ${keywordScope}: ${communities}`,
    "    Iterate through keywords and scroll feeds deeply to discover fresh, qualifying pain posts where the author is stuck, comparing solutions, or seeking tool recommendations.",
    `P4. Execute a continuous hunting chain toward the shift target: ${patrol.maxComments} high-intent comment(s).`,
    "    Methodical sequence per thread: Locate qualifying pain post -> Draft technical value reply -> Publish (or batch for approval) -> Mine post author + engagers -> Salted sleep -> Advance to next candidate thread.",
    "    Continue this chain until the comment budget is fulfilled or candidate search feeds are fully exhausted.",
    "P5. Salted sleep pacing: inject a randomized delay of 20s–45s between published replies to preserve human-like cadence and protect the acting profile against burst rate limits.",
    patrol.requireApproval
      ? "P6. Approval checkpoint is ON: draft comments in batches of 3–5, post each batch in this thread for confirmation, and publish approved batches with salted delays before hunting the next batch."
      : "P6. Approval checkpoint is OFF: publish drafted replies directly with salted delays between each post, logging each published link in this thread.",
    `P7. Mine engagers (post authors, likers, and repliers) from the threads you engage with, targeting up to ${patrol.maxScrapedContacts} contact(s). Extract full profile data including profile picture URL (avatar_url) from post and user elements.`,
    `P8. Write back: stage workflow-runs/${input.workflowRunId}/contacts.csv (header: name,company,title,email,platform,platform_handle,profile_url,avatar_url,notes), then commit with`,
    `    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe`,
    "    Record every published reply as a Signals content_item attributed to this workflow run.",
    "P9. Release the lease when the shift ends: signals-pp-cli targets release --lease <leaseId>, then summarize comments and ingested contacts with links in this thread.",
  ];

  return lines.filter((line) => line !== null).join("\n");
}
