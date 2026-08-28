import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_LABELS,
  RELATIONSHIP_GOAL_STATUS_ENUM,
  RELATIONSHIP_GOAL_STATUS_LABELS,
} from "@/lib/relationship-goals";

export const CONTACT_LIST_PLATFORMS = [
  "linkedin",
  "x",
  "facebook",
  "instagram",
  "gmail",
  "threads",
  "youtube",
] as const;

export const ENRICHMENT_TIERS = ["rich", "good", "basic", "sparse", "minimal"] as const;

export type EnrichmentTier = (typeof ENRICHMENT_TIERS)[number];

export const ENRICHMENT_TIER_LABELS: Record<EnrichmentTier, string> = {
  rich: "Rich (80+)",
  good: "Good (60–79)",
  basic: "Basic (40–59)",
  sparse: "Sparse (20–39)",
  minimal: "Minimal (<20)",
};

export const CONTACT_LIST_SORT_OPTIONS = [
  { value: "createdAt-desc", sort: "createdAt" as const, order: "desc" as const, label: "Recently added" },
  {
    value: "enrichmentScore-asc",
    sort: "enrichmentScore" as const,
    order: "asc" as const,
    label: "Enrichment (low first)",
  },
  {
    value: "enrichmentScore-desc",
    sort: "enrichmentScore" as const,
    order: "desc" as const,
    label: "Enrichment (high first)",
  },
];

export function isEnrichmentTier(value: string): value is EnrichmentTier {
  return (ENRICHMENT_TIERS as readonly string[]).includes(value);
}

export function enrichmentTierToScoreRange(tier: string): {
  minEnrichmentScore?: number;
  maxEnrichmentScore?: number;
} | null {
  if (!isEnrichmentTier(tier)) return null;
  switch (tier) {
    case "rich":
      return { minEnrichmentScore: 80 };
    case "good":
      return { minEnrichmentScore: 60, maxEnrichmentScore: 79 };
    case "basic":
      return { minEnrichmentScore: 40, maxEnrichmentScore: 59 };
    case "sparse":
      return { minEnrichmentScore: 20, maxEnrichmentScore: 39 };
    case "minimal":
      return { maxEnrichmentScore: 19 };
    default:
      return null;
  }
}

export function parseContactListSort(
  sort?: string,
  order?: string,
): { sort?: "createdAt" | "enrichmentScore"; order?: "asc" | "desc" } {
  const normalizedSort = sort === "enrichmentScore" ? "enrichmentScore" : "createdAt";
  const normalizedOrder =
    order === "asc" || order === "desc"
      ? order
      : normalizedSort === "enrichmentScore"
        ? "asc"
        : "desc";
  return { sort: normalizedSort, order: normalizedOrder };
}

export function contactListSortValue(sort?: string, order?: string): string {
  const parsed = parseContactListSort(sort, order);
  return `${parsed.sort}-${parsed.order}`;
}

export const RELATIONSHIP_GOAL_FILTER_OPTIONS = RELATIONSHIP_GOAL_ENUM.map((goal) => ({
  value: goal,
  label: RELATIONSHIP_GOAL_LABELS[goal],
}));

export const RELATIONSHIP_GOAL_STATUS_FILTER_OPTIONS = RELATIONSHIP_GOAL_STATUS_ENUM.map(
  (status) => ({
    value: status,
    label: RELATIONSHIP_GOAL_STATUS_LABELS[status],
  }),
);
