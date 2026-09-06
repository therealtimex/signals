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
 * Discriminators belonging to other prune-category surfaces. A template carrying one of these is
 * not contact dedupe, however similar its run controls look.
 */
const FOREIGN_TEMPLATE_DISCRIMINATORS = ["orgDedupe"] as const;

/**
 * A dedupe template is identified by its run controls, not by name.
 *
 * `tiers` alone is a weak signal: the org deduper is also `templateType: "pruning"` and also has
 * tiers, so shipping it with a top-level `tiers` made the gallery open the *contact* review dialog
 * under the companies template's title. Its controls now live under `orgDedupe`, and this check
 * rejects any known foreign discriminator so the next similar template fails loudly here rather
 * than silently borrowing this surface.
 */
export function isDedupeTemplateConfig(config: Record<string, unknown>): boolean {
  if (FOREIGN_TEMPLATE_DISCRIMINATORS.some((key) => config[key] != null)) return false;
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
