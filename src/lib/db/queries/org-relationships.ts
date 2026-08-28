import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contactPersonas,
  contacts,
  graphEdges,
  interactions,
} from "@/lib/db/schema";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { INTERACTION_TYPE_GROUPS } from "@/lib/db/interaction-types";
import {
  calculateRelationshipStrength,
  type RelationshipStrength,
} from "@/lib/graph/relationship-strength";
import {
  buildIntroductionPaths,
  type IntroPath,
  type SecondDegreeConnection,
} from "@/lib/graph/intro-paths";

type VisibilityOptions = { includeLocalOnly?: boolean };
const COMMUNICATION_TYPES = new Set<string>(INTERACTION_TYPE_GROUPS.communication);

function contactEdges(contactId: string, ownerId: string, options?: VisibilityOptions) {
  return db
    .select()
    .from(graphEdges)
    .where(
      and(
        or(
          and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, ownerId), eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, contactId)),
          and(eq(graphEdges.srcType, "contact"), eq(graphEdges.srcId, contactId), eq(graphEdges.dstType, "contact"), eq(graphEdges.dstId, ownerId)),
        ),
        options?.includeLocalOnly ? undefined : eq(graphEdges.scope, "shared"),
      ),
    )
    .all();
}

export function getContactRelationshipStrength(
  contactId: string,
  options?: VisibilityOptions & { now?: number },
): RelationshipStrength {
  const rows = db
    .select({
      occurredAt: interactions.occurredAt,
      direction: interactions.direction,
      interactionType: interactions.interactionType,
      isMeaningful: interactions.isMeaningful,
    })
    .from(interactions)
    .where(
      and(
        eq(interactions.contactId, contactId),
        options?.includeLocalOnly ? undefined : eq(interactions.scope, "shared"),
      ),
    )
    .all();

  const ownerId = getOwnerContactId();
  const edges = ownerId && ownerId !== contactId ? contactEdges(contactId, ownerId, options) : [];
  let warmth: number | undefined;
  let connected = false;
  let followCount = 0;
  const directions = new Set<string>();
  for (const edge of edges) {
    if (edge.edgeType === "relationship" && edge.weight != null) {
      warmth = warmth === undefined ? edge.weight : Math.max(warmth, edge.weight);
    }
    if (edge.edgeType === "connected_to") connected = true;
    if (edge.edgeType === "follows") {
      followCount++;
      directions.add(`${edge.srcId}:${edge.dstId}`);
    }
  }
  const mutualFollows = ownerId
    ? directions.has(`${ownerId}:${contactId}`) && directions.has(`${contactId}:${ownerId}`)
    : false;

  return calculateRelationshipStrength({
    warmth,
    interactions: rows.map((row) => ({
      occurredAt: row.occurredAt,
      direction: row.direction,
      communication: COMMUNICATION_TYPES.has(row.interactionType),
      meaningful: row.isMeaningful,
    })),
    connection: connected ? "connected" : mutualFollows ? "mutual_follows" : followCount ? "follows" : null,
    now: options?.now,
  });
}

function edgeTouches(edge: typeof graphEdges.$inferSelect, a: string, b: string): boolean {
  return (
    edge.srcType === "contact" &&
    edge.dstType === "contact" &&
    ((edge.srcId === a && edge.dstId === b) || (edge.srcId === b && edge.dstId === a))
  );
}

function connectionKind(edges: (typeof graphEdges.$inferSelect)[]): "connected" | "mutual_follows" | "follows" | null {
  if (edges.some((edge) => edge.edgeType === "connected_to")) return "connected";
  const follows = edges.filter((edge) => edge.edgeType === "follows");
  if (follows.length >= 2) return "mutual_follows";
  return follows.length ? "follows" : null;
}

export function getOrgRelationshipSummary(orgId: string, options?: VisibilityOptions) {
  const employmentRows = db
    .select()
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.orgId, orgId),
        options?.includeLocalOnly ? undefined : eq(contactEmployments.scope, "shared"),
      ),
    )
    .all();
  const currentRows = [] as typeof employmentRows;
  const currentIdSet = new Set<string>();
  const allIdSet = new Set<string>();
  const formerIdSet = new Set<string>();
  for (const employment of employmentRows) {
    allIdSet.add(employment.contactId);
    if (employment.isCurrent) {
      currentRows.push(employment);
      currentIdSet.add(employment.contactId);
    } else {
      formerIdSet.add(employment.contactId);
    }
  }
  const currentIds = [...currentIdSet];
  const allIds = [...allIdSet];
  const peopleRows = allIds.length
    ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, allIds)).all()
    : [];
  const peopleById = new Map(peopleRows.map((person) => [person.id, person]));
  const strengthRows: { contactId: string; name: string; strength: RelationshipStrength }[] = [];
  for (const contactId of currentIds) {
    strengthRows.push({
      contactId,
      name: peopleById.get(contactId)?.name ?? "Unknown",
      strength: getContactRelationshipStrength(contactId, options),
    });
  }
  const strengthById = new Map(strengthRows.map((row) => [row.contactId, row.strength]));

  const emailRows = currentIds.length
    ? db.select().from(contactChannels).where(and(inArray(contactChannels.contactId, currentIds), eq(contactChannels.channelType, "email"))).all()
    : [];
  const identityRows = currentIds.length
    ? db.select({ contactId: contactIdentities.contactId }).from(contactIdentities).where(inArray(contactIdentities.contactId, currentIds)).all()
    : [];
  const identityContactIds = new Set(identityRows.map((row) => row.contactId));
  const personaRows = currentIds.length
    ? db.select({ contactId: contactPersonas.contactId }).from(contactPersonas).where(inArray(contactPersonas.contactId, currentIds)).all()
    : [];
  const personaContactIds = new Set(personaRows.map((row) => row.contactId));

  const interactionRows = allIds.length
    ? db.select({ occurredAt: interactions.occurredAt }).from(interactions).where(
        and(
          or(eq(interactions.orgId, orgId), inArray(interactions.contactId, allIds)),
          options?.includeLocalOnly ? undefined : eq(interactions.scope, "shared"),
        ),
      ).all()
    : db.select({ occurredAt: interactions.occurredAt }).from(interactions).where(eq(interactions.orgId, orgId)).all();

  const ownerId = getOwnerContactId();
  const owner = ownerId
    ? db.select({ contactId: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.id, ownerId)).get() ?? null
    : null;
  const visibleEdges = db.select().from(graphEdges).where(
    options?.includeLocalOnly ? undefined : eq(graphEdges.scope, "shared"),
  ).all();
  const ownerNeighbors: string[] = [];
  const ownerNeighborSet = new Set<string>();
  if (ownerId) {
    for (const edge of visibleEdges) {
      if (edge.srcId !== ownerId && edge.dstId !== ownerId) continue;
      const neighborId: string = edge.srcId === ownerId ? edge.dstId : edge.srcId;
      if (neighborId === ownerId || currentIdSet.has(neighborId) || ownerNeighborSet.has(neighborId)) continue;
      ownerNeighborSet.add(neighborId);
      ownerNeighbors.push(neighborId);
      if (ownerNeighbors.length === 2_000) break;
    }
  }
  const neighborPeople = ownerNeighbors.length
    ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, ownerNeighbors)).all()
    : [];
  const secondDegree: SecondDegreeConnection[] = [];
  const edgesByPair = new Map<string, (typeof visibleEdges)[number][]>();
  for (const edge of visibleEdges) {
    if (edge.srcType !== "contact" || edge.dstType !== "contact") continue;
    const key = edge.srcId < edge.dstId ? `${edge.srcId}:${edge.dstId}` : `${edge.dstId}:${edge.srcId}`;
    const rows = edgesByPair.get(key) ?? [];
    rows.push(edge);
    edgesByPair.set(key, rows);
  }
  for (const neighbor of neighborPeople) {
    const viaStrength = getContactRelationshipStrength(neighbor.id, options);
    for (const targetId of currentIds) {
      const key = neighbor.id < targetId ? `${neighbor.id}:${targetId}` : `${targetId}:${neighbor.id}`;
      const kind = connectionKind(edgesByPair.get(key) ?? []);
      if (kind) secondDegree.push({ targetContactId: targetId, via: { contactId: neighbor.id, name: neighbor.name, strength: viaStrength }, connection: kind });
    }
  }
  const intro = buildIntroductionPaths(
    currentRows.map((employment) => {
      const person = peopleById.get(employment.contactId);
      const strength = strengthById.get(employment.contactId) ?? getContactRelationshipStrength(employment.contactId, options);
      const direct = ownerId
        ? visibleEdges.some((edge) => edgeTouches(edge, ownerId, employment.contactId) && ["relationship", "connected_to", "follows"].includes(edge.edgeType))
        : false;
      return { contactId: employment.contactId, name: person?.name ?? "Unknown", title: employment.title, strength, direct };
    }),
    secondDegree,
  );

  const bands = { unknown: 0, weak: 0, moderate: 0, strong: 0 };
  let best: (typeof strengthRows)[number] | undefined;
  let withRelationship = 0;
  for (const row of strengthRows) {
    bands[row.strength.band]++;
    if (row.strength.band !== "unknown") withRelationship++;
    if (row.strength.score !== null && (!best || row.strength.score > (best.strength.score ?? 0))) {
      best = row;
    }
  }
  const emailContactIds = new Set(emailRows.map((row) => row.contactId));
  const verifiedEmailContactIds = new Set<string>();
  for (const row of emailRows) {
    if (row.isVerified) verifiedEmailContactIds.add(row.contactId);
  }

  return {
    people: {
      total: allIds.length,
      current: currentIds.length,
      former: formerIdSet.size,
    },
    coverage: {
      withEmail: emailContactIds.size,
      withVerifiedEmail: verifiedEmailContactIds.size,
      withIdentity: identityContactIds.size,
      withRelationship,
      withPersona: personaContactIds.size,
    },
    strength: {
      ...bands,
      best: best ? { contactId: best.contactId, name: best.name, score: best.strength.score } : null,
    },
    lastInteractionAt: interactionRows.length
      ? Math.max(...interactionRows.map((row) => row.occurredAt))
      : null,
    owner,
    paths: intro.paths as IntroPath[],
    pathCoverage: intro.coverage,
    snowball: null,
  };
}
