/**
 * Run controls for the Deduplicate & Merge Companies template.
 *
 * Deliberately parallel to `lib/workflows/dedupe-template.ts` but separate: the two templates share
 * a category and a shape, and collapsing them is what made the companies template open the contact
 * dedupe dialog in v0.2.14. The discriminator is `orgDedupe`, not the presence of `tiers`.
 */

export type OrgDedupeTier = 1 | 2;

export const ORG_DEDUPE_DEFAULT_TIERS: OrgDedupeTier[] = [1, 2];
export const ORG_DEDUPE_DEFAULT_MIN_CONFIDENCE = 0.6;
export const ORG_DEDUPE_DEFAULT_LIMIT = 25;

/** Labels describe the evidence, so an operator can tell how much to trust a tier. */
export const ORG_DEDUPE_TIER_PRESETS = [
  { value: "1", label: "Tier 1 only — identical name", tiers: [1] as OrgDedupeTier[] },
  {
    value: "1-2",
    label: "Tier 1 + 2 — adds one name containing another",
    tiers: [1, 2] as OrgDedupeTier[],
  },
] as const;

export type OrgDedupeTierPreset = (typeof ORG_DEDUPE_TIER_PRESETS)[number]["value"];

export interface OrgDedupeRunControls {
  tiers: OrgDedupeTier[];
  minConfidence: number;
  limit: number;
}

export function isOrgDedupeTemplateConfig(config: Record<string, unknown>): boolean {
  const orgDedupe = config.orgDedupe;
  return typeof orgDedupe === "object" && orgDedupe !== null && !Array.isArray(orgDedupe);
}

function toTiers(value: unknown): OrgDedupeTier[] {
  if (!Array.isArray(value)) return ORG_DEDUPE_DEFAULT_TIERS;
  const tiers = value.filter((tier): tier is OrgDedupeTier => tier === 1 || tier === 2);
  return tiers.length > 0 ? [...new Set(tiers)].sort() : ORG_DEDUPE_DEFAULT_TIERS;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readOrgDedupeControls(config: Record<string, unknown>): OrgDedupeRunControls {
  const raw = isOrgDedupeTemplateConfig(config)
    ? (config.orgDedupe as Record<string, unknown>)
    : {};
  return {
    tiers: toTiers(raw.tiers),
    minConfidence: toNumber(raw.minConfidence, ORG_DEDUPE_DEFAULT_MIN_CONFIDENCE),
    limit: toNumber(raw.limit, ORG_DEDUPE_DEFAULT_LIMIT),
  };
}

export function tierPresetFor(tiers: OrgDedupeTier[]): OrgDedupeTierPreset {
  return tiers.length === 1 && tiers[0] === 1 ? "1" : "1-2";
}
