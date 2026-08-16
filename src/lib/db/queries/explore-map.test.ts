import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createContact, updateContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { ensureNicheByName } from "@/lib/db/queries/niches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import {
  contactExploreNodeId,
  getExploreMap,
  nicheExploreNodeId,
} from "@/lib/db/queries/explore-map";
import { db } from "@/lib/db/client";
import { graphEdges, identityMetrics, niches } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

function seedOwner(name = "Owner") {
  const owner = createContact({ name, platform: "x", platformUserId: nanoid() });
  updateContact(owner.id, { isSelf: true });
  return owner;
}

function setEdgeLastSeen(edgeId: string, lastSeenAt: number) {
  db.update(graphEdges).set({ lastSeenAt }).where(eq(graphEdges.id, edgeId)).run();
}

describe("getExploreMap", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("returns empty map when no owner is configured", () => {
    const map = getExploreMap();
    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(map.meta.ownerContactId).toBeNull();
    expect(map.meta.owner).toBeNull();
    expect(map.meta.totalContacts).toBe(0);
  });

  it("includes audience via incoming follow, outgoing follow, and connected_to", () => {
    const owner = seedOwner();
    const incoming = createContact({ name: "Incoming", platform: "x", platformUserId: nanoid() });
    const outgoing = createContact({ name: "Outgoing", platform: "x", platformUserId: nanoid() });
    const connected = createContact({ name: "Connected", platform: "x", platformUserId: nanoid() });
    const unrelated = createContact({ name: "Unrelated", platform: "x", platformUserId: nanoid() });

    upsertGraphEdge({
      srcType: "contact",
      srcId: incoming.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: outgoing.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: connected.id,
      edgeType: "connected_to",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: unrelated.id,
      dstType: "contact",
      dstId: unrelated.id,
      edgeType: "follows",
    });

    const map = getExploreMap();
    const audienceIds = map.nodes
      .filter((node) => node.kind === "contact" && !node.isOwner)
      .map((node) => node.entityId);

    expect(audienceIds).toEqual(
      expect.arrayContaining([incoming.id, outgoing.id, connected.id]),
    );
    expect(audienceIds).not.toContain(unrelated.id);
    expect(map.meta.totalContacts).toBe(3);
  });

  it("excludes local_only edges and niches", () => {
    const owner = seedOwner();
    const visible = createContact({ name: "Visible", platform: "x", platformUserId: nanoid() });
    const hidden = createContact({ name: "Hidden", platform: "x", platformUserId: nanoid() });

    upsertGraphEdge({
      srcType: "contact",
      srcId: visible.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    const privateEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: hidden.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
      scope: "local_only",
      propertiesPrivate: '{"secret":true}',
    });

    const sharedNiche = ensureNicheByName("Shared Niche");
    const localNiche = ensureNicheByName("Local Niche", { scope: "local_only" });

    upsertGraphEdge({
      srcType: "contact",
      srcId: visible.id,
      dstType: "niche",
      dstId: sharedNiche.id,
      edgeType: "belongs_to_niche",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: visible.id,
      dstType: "niche",
      dstId: localNiche.id,
      edgeType: "belongs_to_niche",
    });

    const map = getExploreMap();
    const audienceIds = map.nodes
      .filter((node) => node.kind === "contact" && !node.isOwner)
      .map((node) => node.entityId);

    expect(audienceIds).toEqual([visible.id]);
    expect(map.nodes.some((node) => node.kind === "niche" && node.entityId === localNiche.id)).toBe(
      false,
    );
    expect(map.edges.some((edge) => edge.id === privateEdge.id)).toBe(false);
    expect(JSON.stringify(map)).not.toContain("properties_private");
    expect(JSON.stringify(map)).not.toContain("secret");
  });

  it("collapses mutual follows and preserves one-way direction", () => {
    const owner = seedOwner();
    const a = createContact({ name: "Alice", platform: "x", platformUserId: nanoid() });
    const b = createContact({ name: "Bob", platform: "x", platformUserId: nanoid() });
    const c = createContact({ name: "Cara", platform: "x", platformUserId: nanoid() });

    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: a.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: b.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: c.id,
      edgeType: "follows",
    });

    upsertGraphEdge({
      srcType: "contact",
      srcId: a.id,
      dstType: "contact",
      dstId: b.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: b.id,
      dstType: "contact",
      dstId: a.id,
      edgeType: "follows",
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: c.id,
      dstType: "contact",
      dstId: a.id,
      edgeType: "follows",
    });

    const map = getExploreMap();
    const mutual = map.edges.find(
      (edge) => edge.kind === "follows" && edge.mutual === true,
    );
    expect(mutual).toBeDefined();
    expect(mutual?.source).toBe(contactExploreNodeId(a.id < b.id ? a.id : b.id));
    expect(mutual?.target).toBe(contactExploreNodeId(a.id < b.id ? b.id : a.id));

    const oneWay = map.edges.find(
      (edge) =>
        edge.kind === "follows" &&
        edge.mutual === false &&
        edge.source === contactExploreNodeId(c.id) &&
        edge.target === contactExploreNodeId(a.id),
    );
    expect(oneWay).toBeDefined();
  });

  it("omits edges to truncated-out contacts", () => {
    const owner = seedOwner();
    const kept = createContact({ name: "Alpha", platform: "x", platformUserId: nanoid() });
    const dropped = createContact({ name: "Zulu", platform: "x", platformUserId: nanoid() });

    const keptEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: kept.id,
      edgeType: "follows",
    });
    const droppedEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "contact",
      dstId: dropped.id,
      edgeType: "follows",
    });
    setEdgeLastSeen(keptEdge.id, 2_000);
    setEdgeLastSeen(droppedEdge.id, 1_000);

    upsertGraphEdge({
      srcType: "contact",
      srcId: kept.id,
      dstType: "contact",
      dstId: dropped.id,
      edgeType: "follows",
    });

    const map = getExploreMap({ limit: 1 });
    const nodeIds = new Set(map.nodes.map((node) => node.id));

    expect(map.meta.truncated).toBe(true);
    expect(map.meta.shownContacts).toBe(1);
    expect(map.nodes.some((node) => node.entityId === dropped.id)).toBe(false);
    for (const edge of map.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it("builds niche layer with member counts and nicheIds on contacts", () => {
    const owner = seedOwner();
    const member = createContact({ name: "Member", platform: "x", platformUserId: nanoid() });
    upsertGraphEdge({
      srcType: "contact",
      srcId: member.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });

    const activeNiche = ensureNicheByName("Active");
    const archivedNiche = ensureNicheByName("Archived");
    db.update(niches).set({ status: "archived" }).where(eq(niches.id, archivedNiche.id)).run();

    upsertGraphEdge({
      srcType: "contact",
      srcId: member.id,
      dstType: "niche",
      dstId: activeNiche.id,
      edgeType: "belongs_to_niche",
      weight: 0.8,
    });
    upsertGraphEdge({
      srcType: "contact",
      srcId: member.id,
      dstType: "niche",
      dstId: archivedNiche.id,
      edgeType: "belongs_to_niche",
    });

    const map = getExploreMap();
    const nicheNode = map.nodes.find(
      (node) => node.kind === "niche" && node.entityId === activeNiche.id,
    );
    expect(nicheNode).toMatchObject({
      kind: "niche",
      id: nicheExploreNodeId(activeNiche.id),
      memberCount: 1,
    });
    expect(map.nodes.some((node) => node.kind === "niche" && node.entityId === archivedNiche.id)).toBe(
      false,
    );

    const contactNode = map.nodes.find(
      (node) => node.kind === "contact" && node.entityId === member.id,
    );
    expect(contactNode?.kind === "contact" ? contactNode.nicheIds : []).toEqual([activeNiche.id]);
    expect(map.edges.some((edge) => edge.kind === "belongs_to_niche")).toBe(true);
  });

  it("includes owner niche memberships when there is no audience", () => {
    const owner = seedOwner();
    const niche = ensureNicheByName("Owner Niche");
    upsertGraphEdge({
      srcType: "contact",
      srcId: owner.id,
      dstType: "niche",
      dstId: niche.id,
      edgeType: "belongs_to_niche",
    });

    const map = getExploreMap();
    expect(map.meta.totalContacts).toBe(0);
    expect(map.meta.owner).toEqual({
      id: owner.id,
      name: owner.name,
      avatarUrl: owner.avatarUrl,
    });
    expect(map.nodes.some((node) => node.kind === "niche" && node.entityId === niche.id)).toBe(true);

    const ownerNode = map.nodes.find(
      (node) => node.kind === "contact" && node.entityId === owner.id,
    );
    expect(ownerNode?.kind === "contact" ? ownerNode.nicheIds : []).toEqual([niche.id]);
    expect(map.edges.some((edge) => edge.kind === "belongs_to_niche")).toBe(true);
  });

  it("excludes merged niches from the niche layer", () => {
    const owner = seedOwner();
    const member = createContact({ name: "Member", platform: "x", platformUserId: nanoid() });
    upsertGraphEdge({
      srcType: "contact",
      srcId: member.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });

    const mergedNiche = ensureNicheByName("Merged Niche");
    db.update(niches).set({ status: "merged" }).where(eq(niches.id, mergedNiche.id)).run();
    upsertGraphEdge({
      srcType: "contact",
      srcId: member.id,
      dstType: "niche",
      dstId: mergedNiche.id,
      edgeType: "belongs_to_niche",
    });

    const map = getExploreMap();
    expect(map.nodes.some((node) => node.kind === "niche" && node.entityId === mergedNiche.id)).toBe(
      false,
    );
  });

  it("orders audience contacts by last_seen_at, then name", () => {
    const owner = seedOwner();
    const bravo = createContact({ name: "Bravo", platform: "x", platformUserId: "b-id" });
    const alpha = createContact({ name: "Alpha", platform: "x", platformUserId: "a-id" });
    const charlie = createContact({ name: "Charlie", platform: "x", platformUserId: "c-id" });

    const alphaEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: alpha.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    const bravoEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: bravo.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    const charlieEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: charlie.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });

    setEdgeLastSeen(charlieEdge.id, 3_000);
    setEdgeLastSeen(alphaEdge.id, 2_000);
    setEdgeLastSeen(bravoEdge.id, 2_000);

    const map = getExploreMap({ limit: 2 });
    const audienceIds = new Set(
      map.nodes
        .filter((node) => node.kind === "contact" && !node.isOwner)
        .map((node) => node.entityId),
    );

    expect(map.meta.shownContacts).toBe(2);
    expect(audienceIds.has(charlie.id)).toBe(true);
    expect(audienceIds.has(alpha.id)).toBe(true);
    expect(audienceIds.has(bravo.id)).toBe(false);
  });

  it("breaks equal recency and name ties by contact id", () => {
    const owner = seedOwner();
    const first = createContact({ name: "Peer", platform: "x", platformUserId: nanoid() });
    const second = createContact({ name: "Peer", platform: "x", platformUserId: nanoid() });

    const firstEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: first.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    const secondEdge = upsertGraphEdge({
      srcType: "contact",
      srcId: second.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });
    setEdgeLastSeen(firstEdge.id, 1_500);
    setEdgeLastSeen(secondEdge.id, 1_500);

    const map = getExploreMap({ limit: 1 });
    const included = map.nodes
      .filter((node) => node.kind === "contact" && !node.isOwner)
      .map((node) => node.entityId);

    expect(included).toHaveLength(1);
    const expectedId = first.id.localeCompare(second.id) < 0 ? first.id : second.id;
    expect(included[0]).toBe(expectedId);
  });

  it("uses metric snapshot precedence for followersCount", () => {
    const owner = seedOwner();
    const star = createContact({ name: "Star", platform: "x", platformUserId: nanoid() });
    upsertGraphEdge({
      srcType: "contact",
      srcId: star.id,
      dstType: "contact",
      dstId: owner.id,
      edgeType: "follows",
    });

    const low = createIdentity({
      contactId: star.id,
      platform: "x",
      platformUserId: nanoid(),
      followersCount: 100,
    });
    const high = createIdentity({
      contactId: star.id,
      platform: "linkedin",
      platformUserId: nanoid(),
      followersCount: 50,
    });
    db.insert(identityMetrics)
      .values({
        id: nanoid(),
        contactIdentityId: high.id,
        followersCount: 900,
        snapshotAt: 2_000,
      })
      .run();

    const map = getExploreMap();
    const starNode = map.nodes.find(
      (node) => node.kind === "contact" && node.entityId === star.id,
    );
    expect(starNode?.kind === "contact" ? starNode.followersCount : null).toBe(900);
    expect(low.id).toBeTruthy();
  });
});
