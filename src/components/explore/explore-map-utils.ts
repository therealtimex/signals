import type {
  ExploreMapContactNode,
  ExploreMapEdge,
  ExploreMapNode,
  ExploreMapNicheNode,
} from "@/lib/db/queries/explore-map";

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

export type ExploreMapLayerVisibility = {
  showFollows: boolean;
  showNiches: boolean;
};

export const EXPLORE_MAP_DEFAULT_LAYERS: ExploreMapLayerVisibility = {
  showFollows: true,
  showNiches: true,
};

/** Minimum zoom before audience contact labels render on-canvas. */
export const EXPLORE_MAP_CONTACT_LABEL_MIN_SCALE = 2.5;

export function filterExploreMapEdges(
  edges: ExploreMapEdge[],
  layers: ExploreMapLayerVisibility,
): ExploreMapEdge[] {
  return edges.filter((edge) => {
    if (edge.kind === "belongs_to_niche") return layers.showNiches;
    return layers.showFollows;
  });
}

export function listExploreMapNiches(nodes: ExploreMapNode[]): ExploreMapNicheNode[] {
  return nodes
    .filter((node): node is ExploreMapNicheNode => node.kind === "niche")
    .sort(
      (left, right) =>
        right.memberCount - left.memberCount || left.label.localeCompare(right.label),
    );
}

export function contactMatchesNicheFilter(
  node: ExploreMapContactNode,
  selectedNicheId: string | null,
): boolean {
  if (!selectedNicheId) return true;
  if (node.isOwner) return true;
  return node.nicheIds.includes(selectedNicheId);
}

export function exploreMapNodeOpacity(
  node: ExploreMapNode,
  opts: {
    selectedNicheId: string | null;
    hoveredNodeId: string | null;
  },
): number {
  const { selectedNicheId, hoveredNodeId } = opts;

  if (hoveredNodeId === node.id) return 1;
  if (node.kind === "contact" && node.isOwner) return 1;

  if (selectedNicheId) {
    if (node.kind === "niche") {
      return node.entityId === selectedNicheId ? 1 : 0.35;
    }
    return contactMatchesNicheFilter(node, selectedNicheId) ? 1 : 0.2;
  }

  if (hoveredNodeId) return 0.55;

  return 1;
}

export function shouldRenderExploreNodeLabel(
  node: ExploreMapNode,
  opts: {
    hoveredNodeId: string | null;
    globalScale: number;
  },
): boolean {
  const { hoveredNodeId, globalScale } = opts;

  if (node.kind === "niche") return true;
  if (node.kind === "contact" && node.isOwner) return true;
  if (hoveredNodeId === node.id) return true;
  if (node.kind === "contact" && globalScale >= EXPLORE_MAP_CONTACT_LABEL_MIN_SCALE) {
    return true;
  }
  return false;
}

export function exploreMapNodeTooltip(
  node: ExploreMapNode,
  hoveredNodeId: string | null,
): string {
  if (hoveredNodeId !== node.id) return "";
  if (node.kind === "niche") {
    return `${node.label} · ${node.memberCount} people`;
  }
  return node.label;
}
