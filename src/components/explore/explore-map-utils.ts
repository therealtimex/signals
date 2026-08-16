const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

const NICHE_TYPE_COLOR: Record<string, string> = {
  interest: CHART_COLORS[0],
  firmographic: CHART_COLORS[1],
  behavioral: CHART_COLORS[2],
  custom: CHART_COLORS[3],
};

export const EXPLORE_MAP_OWNER_NODE_VAL = 14;
export const EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX = 10;

export function nicheTypeColor(nicheType: string): string {
  return NICHE_TYPE_COLOR[nicheType] ?? CHART_COLORS[4];
}

export function contactNodeVal(
  followersCount: number | null,
  isOwner: boolean,
): number {
  if (isOwner) return EXPLORE_MAP_OWNER_NODE_VAL;
  const base = Math.log10((followersCount ?? 0) + 1);
  return Math.min(Math.max(base * 2.5, 3), EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX);
}

export function nicheNodeVal(memberCount: number): number {
  return Math.min(Math.max(Math.log10(memberCount + 1) * 2, 4), 10);
}

export function formatExploreMapBadge(meta: {
  totalContacts: number;
  shownContacts: number;
  truncated: boolean;
  nodes: { kind: string }[];
}): string {
  const nicheCount = meta.nodes.filter((node) => node.kind === "niche").length;
  const peopleLabel = meta.truncated
    ? `Showing ${meta.shownContacts} of ${meta.totalContacts} people`
    : `${meta.totalContacts} people`;
  return `${peopleLabel} · ${nicheCount} niches`;
}
