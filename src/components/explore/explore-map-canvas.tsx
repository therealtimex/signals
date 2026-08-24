"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import type { ExploreMapEdge, ExploreMapNode } from "@/lib/db/queries/explore-map";
import {
  buildExploreMapLinkColor,
  nicheTypeResolvedColor,
  withAlpha,
  type ExploreMapThemeColors,
} from "@/components/explore/explore-map-colors";
import {
  contactNodeVal,
  exploreMapNodeOpacity,
  exploreMapNodeTooltip,
  filterExploreMapEdges,
  nicheNodeVal,
  shouldRenderExploreNodeLabel,
  type ExploreMapLayerVisibility,
} from "@/components/explore/explore-map-utils";
import { useExploreMapThemeColors } from "@/components/explore/use-explore-map-theme-colors";

type GraphNode = ExploreMapNode & {
  val: number;
  color: string;
};

type GraphLink = {
  source: string;
  target: string;
  color: string;
  lineWidth: number;
  lineDash: number[] | null;
};

type ExploreMapCanvasProps = {
  nodes: ExploreMapNode[];
  edges: ExploreMapEdge[];
  width: number;
  height: number;
  selectedNicheId: string | null;
  layers: ExploreMapLayerVisibility;
  onContactClick: (contactId: string) => void;
};

export function buildExploreMapGraphData(
  nodes: ExploreMapNode[],
  edges: ExploreMapEdge[],
  theme: ExploreMapThemeColors,
  opts?: {
    selectedNicheId?: string | null;
    hoveredNodeId?: string | null;
  },
): { nodes: GraphNode[]; links: GraphLink[] } {
  const selectedNicheId = opts?.selectedNicheId ?? null;
  const hoveredNodeId = opts?.hoveredNodeId ?? null;

  const graphNodes: GraphNode[] = nodes.map((node) => {
    const baseColor =
      node.kind === "contact"
        ? node.isOwner
          ? theme.primary
          : theme.mutedForeground
        : nicheTypeResolvedColor(node.nicheType, theme);
    const opacity = exploreMapNodeOpacity(node, { selectedNicheId, hoveredNodeId });

    return {
      ...node,
      val:
        node.kind === "contact"
          ? contactNodeVal(node.followersCount, node.isOwner)
          : nicheNodeVal(node.memberCount),
      color: withAlpha(baseColor, opacity),
    };
  });

  const graphLinks: GraphLink[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    color: buildExploreMapLinkColor(edge.kind, edge.mutual, theme),
    lineWidth: edge.kind === "belongs_to_niche" ? 1 : edge.mutual ? 2 : 1,
    lineDash: edge.kind === "belongs_to_niche" ? [4, 4] : null,
  }));

  return { nodes: graphNodes, links: graphLinks };
}

export function ExploreMapCanvas({
  nodes,
  edges,
  width,
  height,
  selectedNicheId,
  layers,
  onContactClick,
}: ExploreMapCanvasProps) {
  const theme = useExploreMapThemeColors();
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, GraphLink> | undefined>(
    undefined,
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const visibleEdges = useMemo(
    () => filterExploreMapEdges(edges, layers),
    [edges, layers],
  );

  const graphData = useMemo(
    () =>
      buildExploreMapGraphData(nodes, visibleEdges, theme, {
        selectedNicheId,
        hoveredNodeId,
      }),
    [nodes, visibleEdges, theme, selectedNicheId, hoveredNodeId],
  );

  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 48);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [graphData]);

  return (
    <ForceGraph2D
      ref={graphRef}
      width={width}
      height={height}
      graphData={graphData}
      nodeId="id"
      nodeLabel={(node) => exploreMapNodeTooltip(node as GraphNode, hoveredNodeId)}
      nodeVal="val"
      nodeColor="color"
      linkColor="color"
      linkWidth="lineWidth"
      linkLineDash="lineDash"
      onNodeClick={(node) => {
        const graphNode = node as GraphNode;
        if (graphNode.kind === "contact") {
          onContactClick(graphNode.entityId);
        }
      }}
      onNodeHover={(node) => {
        setHoveredNodeId(node ? (node as GraphNode).id : null);
      }}
      nodeCanvasObjectMode={() => "after"}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const graphNode = node as NodeObject<GraphNode>;
        if (
          !shouldRenderExploreNodeLabel(graphNode, {
            hoveredNodeId,
            globalScale,
          })
        ) {
          return;
        }

        const label = graphNode.label ?? "";
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = theme.foreground;
        ctx.fillText(
          label,
          graphNode.x ?? 0,
          (graphNode.y ?? 0) + (graphNode.val ?? 4) + fontSize,
        );
      }}
    />
  );
}
