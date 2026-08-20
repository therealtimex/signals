import type { DuplicateTier } from "@/lib/contacts/dedupe/detect";

export const DEDUPE_TEMPLATE_NAME = "Deduplicate & Merge Contacts";

export const DEDUPE_DEFAULT_TIERS: DuplicateTier[] = [1, 2];
export const DEDUPE_DEFAULT_MIN_CONFIDENCE = 0.8;
export const DEDUPE_DEFAULT_LIMIT = 25;

export interface DedupeRunControls {
  tiers: DuplicateTier[];
  minConfidence: number;
  limit: number;
}

/** Tier presets, as the review panel and the activation dialog offer them. */
export const DEDUPE_TIER_PRESETS = [
  { value: "1", label: "Tier 1 only — exact email or handle", tiers: [1] as DuplicateTier[] },
  { value: "1-2", label: "Tier 1 + 2 — adds name at same org", tiers: [1, 2] as DuplicateTier[] },
  { value: "1-3", label: "All tiers — adds graph overlap", tiers: [1, 2, 3] as DuplicateTier[] },
] as const;

export type DedupeTierPreset = (typeof DEDUPE_TIER_PRESETS)[number]["value"];

/**
 * A dedupe template is identified by its run controls, not by name.
 *
 * `tiers` is unique to this template among the prune category, and a user who duplicates the
 * built-in gets a differently named copy that must still behave like the original.
 */
export function isDedupeTemplateConfig(config: Record<string, unknown>): boolean {
  return Array.isArray(config.tiers);
}

function toTiers(value: unknown): DuplicateTier[] {
  if (!Array.isArray(value)) return DEDUPE_DEFAULT_TIERS;
  const tiers = value.filter((tier): tier is DuplicateTier => tier === 1 || tier === 2 || tier === 3);
  return tiers.length > 0 ? [...new Set(tiers)].sort() : DEDUPE_DEFAULT_TIERS;
}

function toNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : fallback;
}

export function readDedupeRunControls(config: Record<string, unknown>): DedupeRunControls {
  return {
    tiers: toTiers(config.tiers),
    minConfidence: clampConfidence(
      toNumber(config.minConfidence, DEDUPE_DEFAULT_MIN_CONFIDENCE)
    ),
    limit: clampLimit(toNumber(config.limit, DEDUPE_DEFAULT_LIMIT)),
  };
}

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return DEDUPE_DEFAULT_MIN_CONFIDENCE;
  return Math.min(Math.max(value, 0), 1);
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEDUPE_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value), 1), 200);
}

export function tierPresetFromTiers(tiers: DuplicateTier[]): DedupeTierPreset {
  const key = [...new Set(tiers)].sort().join(",");
  if (key === "1") return "1";
  if (key === "1,2,3") return "1-3";
  return "1-2";
}

export function tiersFromPreset(preset: string): DuplicateTier[] {
  return (
    DEDUPE_TIER_PRESETS.find((option) => option.value === preset)?.tiers ?? DEDUPE_DEFAULT_TIERS
  );
}

/** Run config for a dedupe template — only its own knobs, never the inactivity-prune ones. */
export function buildDedupeRunConfig(controls: DedupeRunControls): Record<string, unknown> {
  return {
    tiers: controls.tiers,
    minConfidence: clampConfidence(controls.minConfidence),
    limit: clampLimit(controls.limit),
  };
}
