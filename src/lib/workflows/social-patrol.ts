/**
 * "Social Intent Patrol" — a time-boxed engagement shift executed in the Terminal Agent lane.
 *
 * The slider bounds, defaults, and run-config shape live here so the activate dialog, the seed
 * template, and the launch brief cannot drift apart.
 */

export const SOCIAL_INTENT_PATROL_TEMPLATE_NAME = "Social Intent Patrol";

/** Marker key in a template config that switches the activate dialog to the patrol form. */
export const SOCIAL_PATROL_CONFIG_KEY = "socialPatrol";

export const SOCIAL_PATROL_CONFIG_VERSION = 1;

/** Upper bound accepted by `prepare_platform_target` (src/lib/agent-tools/platform-target-handlers.ts). */
export const MAX_LEASE_TTL_SECONDS = 1800;

/** Cap on monitored communities / intent keywords so one run cannot fan out unbounded. */
export const MAX_TAG_COUNT = 20;

export type SocialPatrolSliderKey =
  | "durationMinutes"
  | "maxPosts"
  | "maxComments"
  | "maxScrapedContacts";

export interface SocialPatrolSliderBounds {
  min: number;
  max: number;
  step: number;
  fallback: number;
}

/** Anti-spam guardrails from the template contract — every value is operator-tunable per run. */
export const SOCIAL_PATROL_SLIDERS: Record<SocialPatrolSliderKey, SocialPatrolSliderBounds> = {
  durationMinutes: { min: 5, max: 60, step: 5, fallback: 15 },
  maxPosts: { min: 0, max: 3, step: 1, fallback: 1 },
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
  maxPosts: number;
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

/** Snap to the slider's step grid, then clamp into range. */
export function clampSocialPatrolSlider(key: SocialPatrolSliderKey, value: unknown): number {
  const { min, max, step, fallback } = SOCIAL_PATROL_SLIDERS[key];
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  const snapped = min + Math.round((numeric - min) / step) * step;
  return Math.min(Math.max(snapped, min), max);
}

/** Trim, drop blanks, de-duplicate case-insensitively, and cap the list length. */
export function normalizeTagList(value: unknown, max = MAX_TAG_COUNT): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
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

/** Read stored template/run config into a fully-populated, in-range patrol config. */
export function readSocialPatrolConfig(config: Record<string, unknown>): SocialPatrolConfig {
  const keywords = normalizeTagList(config.intentKeywords);
  return {
    targetId: typeof config.targetId === "string" && config.targetId.trim()
      ? config.targetId.trim()
      : null,
    durationMinutes: clampSocialPatrolSlider("durationMinutes", config.durationMinutes),
    maxPosts: clampSocialPatrolSlider("maxPosts", config.maxPosts),
    maxComments: clampSocialPatrolSlider("maxComments", config.maxComments),
    maxScrapedContacts: clampSocialPatrolSlider(
      "maxScrapedContacts",
      config.maxScrapedContacts,
    ),
    communities: normalizeTagList(config.communities),
    intentKeywords: keywords.length > 0 ? keywords : [...DEFAULT_INTENT_KEYWORDS],
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
    maxPosts: clampSocialPatrolSlider("maxPosts", draft.maxPosts),
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
    maxPosts: SOCIAL_PATROL_SLIDERS.maxPosts.fallback,
    maxComments: SOCIAL_PATROL_SLIDERS.maxComments.fallback,
    maxScrapedContacts: SOCIAL_PATROL_SLIDERS.maxScrapedContacts.fallback,
    communities: [],
    intentKeywords: [...DEFAULT_INTENT_KEYWORDS],
    requireApproval: true,
  };
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

  const lines = [
    "Social Intent Patrol execution contract:",
    `P1. Acquire the acting lease: signals-pp-cli targets prepare ${target} --intent browse --ttl ${ttl}`,
    `    Lease TTL is capped at ${MAX_LEASE_TTL_SECONDS}s — for a ${patrol.durationMinutes}-minute shift, renew with --lease <leaseId> instead of requesting a longer TTL.`,
    "P2. Connect to the `signals-publish` RealTimeX Browser session over CDP using the agent-browser skill. Do not drive the platform through agent-tools.",
    `P3. Patrol these communities for intent keywords (${patrol.intentKeywords.join(", ")}): ${communities}`,
    `P4. Stay inside the shift budget: at most ${patrol.maxPosts} personal profile post(s), ${patrol.maxComments} high-intent comment(s), and ${patrol.durationMinutes} minute(s) of wall clock.`,
    patrol.maxPosts === 0
      ? "    maxPosts is 0 — this is a lurk-and-engage-only shift. Do not publish to the personal profile."
      : null,
    patrol.requireApproval
      ? "P5. Approval checkpoint is ON: post each drafted comment in this thread and wait for confirmation before publishing it."
      : "P5. Approval checkpoint is OFF: publish drafted comments directly, and log each one in this thread.",
    `P6. Mine engagers (likers and repliers) of the pain posts you engage with, up to ${patrol.maxScrapedContacts} contact(s).`,
    `P7. Write back: stage workflow-runs/${input.workflowRunId}/contacts.csv, then commit with`,
    `    signals-pp-cli import contacts --file workflow-runs/${input.workflowRunId}/contacts.csv --dedupe`,
    "    Record every published reply as a Signals content_item attributed to this workflow run.",
    "P8. Release the lease when the shift ends: signals-pp-cli targets release --lease <leaseId>, then summarize posts, comments, and ingested contacts with links in this thread.",
  ];

  return lines.filter((line) => line !== null).join("\n");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
