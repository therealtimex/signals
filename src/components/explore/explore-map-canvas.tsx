"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import type { ExploreMapEdge, ExploreMapNode } from "@/lib/db/queries/explore-map";
import {
  applyResolvedColorOpacity,
  buildExploreMapLinkColor,
  type ExploreMapThemeColors,
} from "@/components/explore/explore-map-colors";
import {
  getExploreMapAvatar,
  subscribeExploreMapAvatarCache,
} from "@/components/explore/explore-map-avatar-cache";
import {
  buildExploreNicheColorMap,
  contactNodeBaseColor,
  contactNodeVal,
  exploreContactInitials,
  exploreMapContactScreenRadius,
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
  baseColor: string;
  nicheColor?: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type GraphLink = {
  source: string;
  target: string;
  color: string;
  lineWidth: number;
  lineDash: number[] | null;
};

export type ExploreMapHoverContact = {
  contactId: string;
  label: string;
  avatarUrl: string | null;
  screenX: number;
  screenY: number;
};

type ExploreMapCanvasProps = {
  nodes: ExploreMapNode[];
  edges: ExploreMapEdge[];
  width: number;
  height: number;
  selectedNicheId: string | null;
  layers: ExploreMapLayerVisibility;
  onContactClick: (contactId: string) => void;
  onHoverContactChange: (contact: ExploreMapHoverContact | null) => void;
};

export function buildExploreMapGraphData(
  nodes: ExploreMapNode[],
  edges: ExploreMapEdge[],
  theme: ExploreMapThemeColors,
): { nodes: GraphNode[]; links: GraphLink[]; nicheColorMap: Map<string, string> } {
  const nicheColorMap = buildExploreNicheColorMap(nodes, theme);

  const graphNodes: GraphNode[] = nodes.map((node) => {
    if (node.kind === "contact") {
      return {
        ...node,
        val: contactNodeVal(node.followersCount, node.isOwner),
        baseColor: contactNodeBaseColor(node, nicheColorMap, theme),
        nicheColor: node.nicheIds[0] ? nicheColorMap.get(node.nicheIds[0]) : undefined,
      };
    }
    return {
      ...node,
      val: nicheNodeVal(node.memberCount),
      baseColor: nicheColorMap.get(node.entityId) ?? theme.primary,
    };
  });

  const graphLinks: GraphLink[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    color: buildExploreMapLinkColor(edge.kind, edge.mutual, theme),
    lineWidth: edge.kind === "belongs_to_niche" ? 1 : edge.mutual ? 2 : 1,
    lineDash: edge.kind === "belongs_to_niche" ? [4, 4] : null,
  }));

  return { nodes: graphNodes, links: graphLinks, nicheColorMap };
}

export function exploreMapLayoutSignature(
  nodes: ExploreMapNode[],
  edges: ExploreMapEdge[],
  selectedNicheId: string | null,
  layers: ExploreMapLayerVisibility,
): string {
  return [
    nodes.length,
    edges.length,
    selectedNicheId ?? "",
    layers.showFollows,
    layers.showNiches,
  ].join("|");
}

function drawAvatarNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  avatarUrl: string | null,
  label: string,
) {
  const image = getExploreMapAvatar(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `600 ${Math.max(radius * 0.95, 4)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(exploreContactInitials(label), x, y);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(radius * 0.12, 0.5);
  ctx.stroke();
}

function drawNichePill(
  ctx: CanvasRenderingContext2D,
  node: NodeObject<GraphNode>,
  globalScale: number,
  color: string,
  opacity: number,
) {
  const label = node.label ?? "";
  const fontSize = 11 / globalScale;
  const padX = 8 / globalScale;
  const padY = 4 / globalScale;
  const dot = 6 / globalScale;
  ctx.font = `600 ${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const pillWidth = dot + padX + textWidth + padX * 2;
  const pillHeight = Math.max(fontSize + padY * 2, dot + padY);
  const x = (node.x ?? 0) - pillWidth / 2;
  const y = (node.y ?? 0) - pillHeight / 2;

  ctx.fillStyle = `rgba(0,0,0,${0.55 * opacity})`;
  const radius = pillHeight / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.quadraticCurveTo(x + pillWidth, y, x + pillWidth, y + radius);
  ctx.lineTo(x + pillWidth, y + pillHeight - radius);
  ctx.quadraticCurveTo(x + pillWidth, y + pillHeight, x + pillWidth - radius, y + pillHeight);
  ctx.lineTo(x + radius, y + pillHeight);
  ctx.quadraticCurveTo(x, y + pillHeight, x, y + pillHeight - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, y + pillHeight / 2, dot / 2, 0, 2 * Math.PI, false);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = `rgba(255,255,255,${0.92 * opacity})`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX + dot + padX * 0.5, y + pillHeight / 2);
}

export function ExploreMapCanvas({
  nodes,
  edges,
  width,
  height,
  selectedNicheId,
  layers,
  onContactClick,
  onHoverContactChange,
}: ExploreMapCanvasProps) {
  const theme = useExploreMapThemeColors();
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, GraphLink> | undefined>(
    undefined,
  );
  const hoveredNodeIdRef = useRef<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [avatarEpoch, setAvatarEpoch] = useState(0);
  const hasFitRef = useRef(false);

  const visibleEdges = useMemo(
    () => filterExploreMapEdges(edges, layers),
    [edges, layers],
  );

  const graphBundle = useMemo(
    () => buildExploreMapGraphData(nodes, visibleEdges, theme),
    [nodes, visibleEdges, theme],
  );
  const graphData = useMemo(
    () => ({ nodes: graphBundle.nodes, links: graphBundle.links }),
    [graphBundle],
  );

  const layoutSignature = useMemo(
    () => exploreMapLayoutSignature(nodes, visibleEdges, selectedNicheId, layers),
    [nodes, visibleEdges, selectedNicheId, layers],
  );

  useEffect(() => subscribeExploreMapAvatarCache(() => setAvatarEpoch((value) => value + 1)), []);

  useEffect(() => {
    hasFitRef.current = false;
  }, [layoutSignature]);

  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    const owner = graphData.nodes.find(
      (node) => node.kind === "contact" && node.isOwner,
    );
    const niches = graphData.nodes.filter((node) => node.kind === "niche");
    const ring = Math.min(width, height) * 0.36;

    if (owner) {
      owner.fx = 0;
      owner.fy = 0;
    }

    for (const [index, niche] of niches.entries()) {
      const angle = (2 * Math.PI * index) / niches.length - Math.PI / 2;
      niche.fx = Math.cos(angle) * ring;
      niche.fy = Math.sin(angle) * ring;
    }

    for (const node of graphData.nodes) {
      if (node.kind === "contact" && !node.isOwner) {
        node.fx = undefined;
        node.fy = undefined;
      }
    }

    graphRef.current.resumeAnimation();
    graphRef.current.d3ReheatSimulation();
  }, [graphData, width, height, layoutSignature]);

  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;

    if (!selectedNicheId) {
      hasFitRef.current = false;
      const timer = window.setTimeout(() => {
        graphRef.current?.zoomToFit(400, 56);
        hasFitRef.current = true;
      }, 300);
      return () => window.clearTimeout(timer);
    }

    const niche = graphData.nodes.find(
      (node) => node.kind === "niche" && node.entityId === selectedNicheId,
    );
    if (niche?.x == null || niche?.y == null) return;

    graphRef.current.centerAt(niche.x, niche.y, 600);
    graphRef.current.zoom(2.4, 600);
    return undefined;
  }, [selectedNicheId, graphData]);

  const resolveNodeColor = (node: GraphNode) =>
    applyResolvedColorOpacity(
      node.baseColor,
      exploreMapNodeOpacity(node, {
        selectedNicheId,
        hoveredNodeId,
      }),
    );

  return (
    <ForceGraph2D
      ref={graphRef}
      width={width}
      height={height}
      graphData={graphData}
      nodeId="id"
      nodeLabel={(node) => exploreMapNodeTooltip(node as GraphNode, hoveredNodeId)}
      nodeVal="val"
      linkColor="color"
      linkWidth="lineWidth"
      linkLineDash="lineDash"
      cooldownTicks={100}
      d3AlphaDecay={0.06}
      onEngineStop={() => {
        graphRef.current?.pauseAnimation();
      }}
      onNodeClick={(node) => {
        const graphNode = node as GraphNode;
        if (graphNode.kind === "contact") {
          onContactClick(graphNode.entityId);
        }
        if (graphNode.kind === "niche") {
          // niche clicks handled by toolbar; allow canvas pill as shortcut
        }
      }}
      onNodeHover={(node) => {
        const nextId = node ? (node as GraphNode).id : null;
        if (nextId === hoveredNodeIdRef.current) return;
        hoveredNodeIdRef.current = nextId;
        setHoveredNodeId(nextId);

        if (!node || (node as GraphNode).kind !== "contact") {
          onHoverContactChange(null);
          return;
        }

        const graphNode = node as GraphNode;
        const coords = graphRef.current?.graph2ScreenCoords(
          graphNode.x ?? 0,
          graphNode.y ?? 0,
        );
        if (!coords) {
          onHoverContactChange(null);
          return;
        }

        onHoverContactChange({
          contactId: graphNode.entityId,
          label: graphNode.label,
          avatarUrl: graphNode.kind === "contact" ? graphNode.avatarUrl : null,
          screenX: coords.x,
          screenY: coords.y,
        });
      }}
      nodeCanvasObjectMode={() => "replace"}
      nodeCanvasObject={(node, ctx, globalScale) => {
        void avatarEpoch;
        const graphNode = node as NodeObject<GraphNode>;
        const x = graphNode.x ?? 0;
        const y = graphNode.y ?? 0;
        const opacity = exploreMapNodeOpacity(graphNode, {
          selectedNicheId,
          hoveredNodeId,
        });
        const color = resolveNodeColor(graphNode);

        if (graphNode.kind === "niche") {
          drawNichePill(ctx, graphNode, globalScale, graphNode.baseColor, opacity);
          return;
        }

        const isHovered = hoveredNodeId === graphNode.id;
        const radius = exploreMapContactScreenRadius(globalScale, {
          isOwner: graphNode.isOwner,
          isHovered,
        });

        drawAvatarNode(
            ctx,
            x,
            y,
            radius,
            color,
            graphNode.avatarUrl,
            graphNode.label,
        );

        if (shouldRenderExploreNodeLabel(graphNode, hoveredNodeId)) {
          const label = graphNode.label ?? "";
          const fontSize = 11 / globalScale;
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = theme.foreground;
          ctx.fillText(label, x, y + radius + fontSize);
        }
      }}
    />
  );
}
