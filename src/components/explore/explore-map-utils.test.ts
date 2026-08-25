import { describe, expect, it } from "vitest";
import type { ExploreMapContactNode, ExploreMapEdge } from "@/lib/db/queries/explore-map";
import {
  contactMatchesNicheFilter,
  contactNodeVal,
  EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX,
  EXPLORE_MAP_OWNER_NODE_VAL,
  exploreMapNodeOpacity,
  exploreMapNodeTooltip,
  filterExploreMapEdges,
  listExploreMapNiches,
  nicheNodeVal,
  nicheTypeColor,
  shouldRenderExploreNodeLabel,
} from "@/components/explore/explore-map-utils";

const audienceContact: ExploreMapContactNode = {
  id: "contact:peer",
  kind: "contact",
  entityId: "peer",
  label: "Peer",
  avatarUrl: null,
  isOwner: false,
  followersCount: 100,
  nicheIds: ["niche-ai"],
};

const ownerContact: ExploreMapContactNode = {
  ...audienceContact,
  id: "contact:owner",
  entityId: "owner",
  label: "Owner",
  isOwner: true,
  nicheIds: [],
};

describe("explore-map-utils", () => {
  it("keeps the owner larger than any audience node", () => {
    expect(contactNodeVal(null, true)).toBe(EXPLORE_MAP_OWNER_NODE_VAL);
    expect(contactNodeVal(10_000_000, false)).toBe(EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX);
    expect(contactNodeVal(null, true)).toBeGreaterThan(contactNodeVal(10_000_000, false));
  });

  it("maps niche types to chart tokens", () => {
    expect(nicheTypeColor("interest")).toContain("chart");
    expect(nicheNodeVal(10)).toBeGreaterThan(0);
  });
});

describe("explore map legibility helpers", () => {
  const edges: ExploreMapEdge[] = [
    {
      id: "edge-follow",
      source: "contact:owner",
      target: "contact:peer",
      kind: "follows",
      mutual: true,
      weight: null,
    },
    {
      id: "edge-niche",
      source: "contact:peer",
      target: "niche:niche-ai",
      kind: "belongs_to_niche",
      mutual: null,
      weight: 0.8,
    },
  ];

  it("filters edge layers independently", () => {
    expect(filterExploreMapEdges(edges, { showFollows: true, showNiches: false })).toEqual([
      edges[0],
    ]);
    expect(filterExploreMapEdges(edges, { showFollows: false, showNiches: true })).toEqual([
      edges[1],
    ]);
  });

  it("sorts niches by member count", () => {
    const niches = listExploreMapNiches([
      {
        id: "niche:b",
        kind: "niche",
        entityId: "b",
        label: "Beta",
        nicheType: "interest",
        memberCount: 2,
      },
      {
        id: "niche:a",
        kind: "niche",
        entityId: "a",
        label: "Alpha",
        nicheType: "interest",
        memberCount: 5,
      },
    ]);

    expect(niches.map((niche) => niche.entityId)).toEqual(["a", "b"]);
  });

  it("dims non-matching contacts when a niche is selected", () => {
    const unmatched: ExploreMapContactNode = {
      ...audienceContact,
      nicheIds: ["niche-other"],
    };

    expect(exploreMapNodeOpacity(unmatched, { selectedNicheId: "niche-ai", hoveredNodeId: null })).toBe(
      0.2,
    );
    expect(exploreMapNodeOpacity(ownerContact, { selectedNicheId: "niche-ai", hoveredNodeId: null })).toBe(
      1,
    );
  });

  it("shows contact labels only when hovered", () => {
    expect(shouldRenderExploreNodeLabel(audienceContact, null)).toBe(false);
    expect(shouldRenderExploreNodeLabel(audienceContact, audienceContact.id)).toBe(true);
    expect(shouldRenderExploreNodeLabel(ownerContact, null)).toBe(true);
  });

  it("limits tooltips to the hovered node", () => {
    expect(exploreMapNodeTooltip(audienceContact, audienceContact.id)).toBe("Peer");
    expect(exploreMapNodeTooltip(audienceContact, null)).toBe("");
  });

  it("matches contacts to niche filters while keeping the owner visible", () => {
    expect(contactMatchesNicheFilter(audienceContact, "niche-ai")).toBe(true);
    expect(contactMatchesNicheFilter(audienceContact, "niche-other")).toBe(false);
    expect(contactMatchesNicheFilter(ownerContact, "niche-other")).toBe(true);
  });
});
