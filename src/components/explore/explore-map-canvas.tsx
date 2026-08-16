"use client";

import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import type { ExploreMapEdge, ExploreMapNode } from "@/lib/db/queries/explore-map";
import {
  buildExploreMapLinkColor,
  nicheTypeResolvedColor,
  type ExploreMapThemeColors,
} from "@/components/explore/explore-map-colors";
import { contactNodeVal, nicheNodeVal } from "@/components/explore/explore-map-utils";
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
  onContactClick: (contactId: string) => void;
};

export function buildExploreMapGraphData(
  nodes: ExploreMapNode[],
  edges: ExploreMapEdge[],
  theme: ExploreMapThemeColors,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const graphNodes: GraphNode[] = nodes.map((node) => {
    if (node.kind === "contact") {
      return {
        ...node,
        val: contactNodeVal(node.followersCount, node.isOwner),
        color: node.isOwner ? theme.primary : theme.mutedForeground,
      };
    }
    return {
      ...node,
      val: nicheNodeVal(node.memberCount),
      color: nicheTypeResolvedColor(node.nicheType, theme),
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
  onContactClick,
}: ExploreMapCanvasProps) {
  const theme = useExploreMapThemeColors();
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, GraphLink> | undefined>(
    undefined,
  );

  const graphData = useMemo(
    () => buildExploreMapGraphData(nodes, edges, theme),
    [nodes, edges, theme],
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
      nodeLabel="label"
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
      nodeCanvasObjectMode={() => "after"}
      nodeCanvasObject={(node, ctx, globalScale) => {
        if (globalScale < 1.5) return;
        const graphNode = node as NodeObject<GraphNode>;
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
