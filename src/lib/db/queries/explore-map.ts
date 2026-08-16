import { and, asc, eq, inArray, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, graphEdges, niches } from "@/lib/db/schema";
import type { GraphEdge } from "@/lib/db/types";
import { maxFollowersCountByContactIds } from "@/lib/db/queries/contact-explore";
import { getOwnerContactId } from "@/lib/db/queries/contacts";

export type ExploreMapContactNode = {
  id: string;
  kind: "contact";
  entityId: string;
  label: string;
  avatarUrl: string | null;
  isOwner: boolean;
  followersCount: number | null;
  nicheIds: string[];
};

export type ExploreMapNicheNode = {
  id: string;
  kind: "niche";
  entityId: string;
  label: string;
  nicheType: string;
  memberCount: number;
};

export type ExploreMapNode = ExploreMapContactNode | ExploreMapNicheNode;

export type ExploreMapEdge = {
  id: string;
  source: string;
  target: string;
  kind: "follows" | "connected_to" | "belongs_to_niche";
  mutual: boolean | null;
  weight: number | null;
};

export type ExploreMapResponse = {
  nodes: ExploreMapNode[];
  edges: ExploreMapEdge[];
  meta: {
    ownerContactId: string | null;
    owner: { id: string; name: string; avatarUrl: string | null } | null;
    totalContacts: number;
    shownContacts: number;
    truncated: boolean;
    limit: number;
  };
};

export const EXPLORE_MAP_DEFAULT_LIMIT = 200;
export const EXPLORE_MAP_MAX_LIMIT = 500;

const CONTACT_NODE_PREFIX = "contact:";
const NICHE_NODE_PREFIX = "niche:";
const CONTACT_EDGE_TYPES = ["follows", "connected_to"] as const;
const EXCLUDED_NICHE_STATUSES = ["merged", "archived"] as const;

export function contactExploreNodeId(contactId: string): string {
  return `${CONTACT_NODE_PREFIX}${contactId}`;
}

export function nicheExploreNodeId(nicheId: string): string {
  return `${NICHE_NODE_PREFIX}${nicheId}`;
}

function emptyExploreMap(limit: number, ownerContactId: string | null = null): ExploreMapResponse {
  return {
    nodes: [],
    edges: [],
    meta: {
      ownerContactId,
      owner: null,
      totalContacts: 0,
      shownContacts: 0,
      truncated: false,
      limit,
    },
  };
}

function ownerMetaFromRow(
  ownerContactId: string,
  rows: { id: string; name: string; avatarUrl: string | null }[],
): { id: string; name: string; avatarUrl: string | null } {
  const row = rows.find((entry) => entry.id === ownerContactId);
  return {
    id: ownerContactId,
    name: row?.name ?? "You",
    avatarUrl: row?.avatarUrl ?? null,
  };
}

function collapseContactEdges(edges: GraphEdge[]): ExploreMapEdge[] {
  const follows = edges.filter((edge) => edge.edgeType === "follows");
  const connected = edges.filter((edge) => edge.edgeType === "connected_to");
  const result: ExploreMapEdge[] = [];

  const forward = new Map<string, GraphEdge>();
  for (const edge of follows) {
    forward.set(`${edge.srcId}:${edge.dstId}`, edge);
  }

  const pairKeys = new Set<string>();
  for (const edge of follows) {
    pairKeys.add([edge.srcId, edge.dstId].sort().join(":"));
  }

  for (const pairKey of pairKeys) {
    const [a, b] = pairKey.split(":");
    const ab = forward.get(`${a}:${b}`);
    const ba = forward.get(`${b}:${a}`);

    if (ab && ba) {
      const survivor =
        ab.lastSeenAt > ba.lastSeenAt
          ? ab
          : ab.lastSeenAt < ba.lastSeenAt
            ? ba
            : ab.id <= ba.id
              ? ab
              : ba;
      result.push({
        id: survivor.id,
        source: contactExploreNodeId(a),
        target: contactExploreNodeId(b),
        kind: "follows",
        mutual: true,
        weight: survivor.weight,
      });
      continue;
    }

    const directed = ab ?? ba;
    if (!directed) continue;
    result.push({
      id: directed.id,
      source: contactExploreNodeId(directed.srcId),
      target: contactExploreNodeId(directed.dstId),
      kind: "follows",
      mutual: false,
      weight: directed.weight,
    });
  }

  const seenConnected = new Set<string>();
  for (const edge of connected) {
    const [minId, maxId] =
      edge.srcId < edge.dstId ? [edge.srcId, edge.dstId] : [edge.dstId, edge.srcId];
    const pairKey = `${minId}:${maxId}`;
    if (seenConnected.has(pairKey)) continue;
    seenConnected.add(pairKey);
    result.push({
      id: edge.id,
      source: contactExploreNodeId(minId),
      target: contactExploreNodeId(maxId),
      kind: "connected_to",
      mutual: null,
      weight: edge.weight,
    });
  }

  return result;
}

export function getExploreMap(opts?: { limit?: number }): ExploreMapResponse {
  const limit = Math.min(
    Math.max(opts?.limit ?? EXPLORE_MAP_DEFAULT_LIMIT, 1),
    EXPLORE_MAP_MAX_LIMIT,
  );

  const ownerContactId = getOwnerContactId();
  if (!ownerContactId) {
    return emptyExploreMap(limit);
  }

  const ownerAdjacentEdges = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.scope, "shared"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "contact"),
        or(
          eq(graphEdges.edgeType, "follows"),
          eq(graphEdges.edgeType, "connected_to"),
        ),
        or(eq(graphEdges.srcId, ownerContactId), eq(graphEdges.dstId, ownerContactId)),
      ),
    )
    .all();

  const audienceLastSeen = new Map<string, number>();
  for (const edge of ownerAdjacentEdges) {
    const otherId: string = edge.srcId === ownerContactId ? edge.dstId : edge.srcId;
    if (otherId === ownerContactId) continue;
    const current = audienceLastSeen.get(otherId);
    if (current === undefined || edge.lastSeenAt > current) {
      audienceLastSeen.set(otherId, edge.lastSeenAt);
    }
  }

  const audienceIds = [...audienceLastSeen.keys()];

  const audienceNameRows =
    audienceIds.length === 0
      ? []
      : db
          .select({ id: contacts.id, name: contacts.name })
          .from(contacts)
          .where(inArray(contacts.id, audienceIds))
          .all();
  const nameById = new Map(audienceNameRows.map((row) => [row.id, row.name]));

  audienceIds.sort((a, b) => {
    const lastA = audienceLastSeen.get(a) ?? 0;
    const lastB = audienceLastSeen.get(b) ?? 0;
    if (lastB !== lastA) return lastB - lastA;
    const nameCmp = (nameById.get(a) ?? "").localeCompare(nameById.get(b) ?? "");
    if (nameCmp !== 0) return nameCmp;
    return a.localeCompare(b);
  });

  const totalContacts = audienceIds.length;
  const shownAudienceIds = audienceIds.slice(0, limit);
  const includedContactIds = [ownerContactId, ...shownAudienceIds];

  const contactRows = db
    .select({
      id: contacts.id,
      name: contacts.name,
      avatarUrl: contacts.avatarUrl,
    })
    .from(contacts)
    .where(inArray(contacts.id, includedContactIds))
    .orderBy(asc(contacts.name))
    .all();

  const followersByContact = maxFollowersCountByContactIds(includedContactIds);

  const contactEdges =
    includedContactIds.length < 2
      ? []
      : db
          .select()
          .from(graphEdges)
          .where(
            and(
              eq(graphEdges.scope, "shared"),
              eq(graphEdges.srcType, "contact"),
              eq(graphEdges.dstType, "contact"),
              or(
                eq(graphEdges.edgeType, "follows"),
                eq(graphEdges.edgeType, "connected_to"),
              ),
              inArray(graphEdges.srcId, includedContactIds),
              inArray(graphEdges.dstId, includedContactIds),
            ),
          )
          .all();

  const collapsedContactEdges = collapseContactEdges(contactEdges);

  const nicheMembershipRows = db
    .select({
      edgeId: graphEdges.id,
      contactId: graphEdges.srcId,
      nicheId: graphEdges.dstId,
      weight: graphEdges.weight,
      nicheName: niches.name,
      nicheType: niches.nicheType,
    })
    .from(graphEdges)
    .innerJoin(
      niches,
      and(eq(graphEdges.dstId, niches.id), eq(graphEdges.dstType, "niche")),
    )
    .where(
      and(
        eq(graphEdges.scope, "shared"),
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        inArray(graphEdges.srcId, includedContactIds),
        eq(niches.scope, "shared"),
        notInArray(niches.status, [...EXCLUDED_NICHE_STATUSES]),
      ),
    )
    .all();

  const nicheIdsByContact = new Map<string, string[]>();
  for (const contactId of includedContactIds) {
    nicheIdsByContact.set(contactId, []);
  }

  const nicheMemberCounts = new Map<string, number>();
  const nicheMeta = new Map<string, { name: string; nicheType: string }>();

  for (const row of nicheMembershipRows) {
    nicheIdsByContact.get(row.contactId)?.push(row.nicheId);
    nicheMemberCounts.set(row.nicheId, (nicheMemberCounts.get(row.nicheId) ?? 0) + 1);
    nicheMeta.set(row.nicheId, { name: row.nicheName, nicheType: row.nicheType });
  }

  const contactNodes: ExploreMapContactNode[] = contactRows.map((row) => ({
    id: contactExploreNodeId(row.id),
    kind: "contact",
    entityId: row.id,
    label: row.name,
    avatarUrl: row.avatarUrl,
    isOwner: row.id === ownerContactId,
    followersCount: followersByContact.get(row.id) ?? null,
    nicheIds: nicheIdsByContact.get(row.id) ?? [],
  }));

  const nicheNodes: ExploreMapNicheNode[] = [...nicheMeta.entries()].map(([nicheId, meta]) => ({
    id: nicheExploreNodeId(nicheId),
    kind: "niche",
    entityId: nicheId,
    label: meta.name,
    nicheType: meta.nicheType,
    memberCount: nicheMemberCounts.get(nicheId) ?? 0,
  }));

  const nicheEdges: ExploreMapEdge[] = nicheMembershipRows.map((row) => ({
    id: row.edgeId,
    source: contactExploreNodeId(row.contactId),
    target: nicheExploreNodeId(row.nicheId),
    kind: "belongs_to_niche",
    mutual: null,
    weight: row.weight,
  }));

  const nodeIds = new Set([
    ...contactNodes.map((node) => node.id),
    ...nicheNodes.map((node) => node.id),
  ]);

  const edges = [...collapsedContactEdges, ...nicheEdges].filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  return {
    nodes: [...contactNodes, ...nicheNodes],
    edges,
    meta: {
      ownerContactId,
      owner: ownerMetaFromRow(ownerContactId, contactRows),
      totalContacts,
      shownContacts: shownAudienceIds.length,
      truncated: totalContacts > limit,
      limit,
    },
  };
}
