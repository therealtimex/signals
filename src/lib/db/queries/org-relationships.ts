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
  const warmth = edges
    .filter((edge) => edge.edgeType === "relationship" && edge.weight != null)
    .map((edge) => edge.weight!)
    .sort((a, b) => b - a)[0];
  const connected = edges.some((edge) => edge.edgeType === "connected_to");
  const follows = edges.filter((edge) => edge.edgeType === "follows");
  const directions = new Set(follows.map((edge) => `${edge.srcId}:${edge.dstId}`));
  const mutualFollows = ownerId
    ? directions.has(`${ownerId}:${contactId}`) && directions.has(`${contactId}:${ownerId}`)
    : false;

  return calculateRelationshipStrength({
    warmth,
    interactions: rows.map((row) => ({
      occurredAt: row.occurredAt,
      direction: row.direction,
      communication: (INTERACTION_TYPE_GROUPS.communication as readonly string[]).includes(
        row.interactionType,
      ),
      meaningful: row.isMeaningful,
    })),
    connection: connected ? "connected" : mutualFollows ? "mutual_follows" : follows.length ? "follows" : null,
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
  const currentRows = employmentRows.filter((employment) => employment.isCurrent);
  const currentIds = [...new Set(currentRows.map((employment) => employment.contactId))];
  const allIds = [...new Set(employmentRows.map((employment) => employment.contactId))];
  const peopleRows = allIds.length
    ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, allIds)).all()
    : [];
  const peopleById = new Map(peopleRows.map((person) => [person.id, person]));
  const strengthRows = currentIds.map((contactId) => ({
    contactId,
    name: peopleById.get(contactId)?.name ?? "Unknown",
    strength: getContactRelationshipStrength(contactId, options),
  }));
  const strengthById = new Map(strengthRows.map((row) => [row.contactId, row.strength]));

  const emailRows = currentIds.length
    ? db.select().from(contactChannels).where(and(inArray(contactChannels.contactId, currentIds), eq(contactChannels.channelType, "email"))).all()
    : [];
  const identityContactIds = new Set(
    currentIds.length
      ? db.select({ contactId: contactIdentities.contactId }).from(contactIdentities).where(inArray(contactIdentities.contactId, currentIds)).all().map((row) => row.contactId)
      : [],
  );
  const personaContactIds = new Set(
    currentIds.length
      ? db.select({ contactId: contactPersonas.contactId }).from(contactPersonas).where(inArray(contactPersonas.contactId, currentIds)).all().map((row) => row.contactId)
      : [],
  );

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
  const ownerNeighbors = ownerId
    ? [...new Set(visibleEdges.filter((edge) => edge.srcId === ownerId || edge.dstId === ownerId).map((edge) => edge.srcId === ownerId ? edge.dstId : edge.srcId))]
        .filter((id) => id !== ownerId && !currentIds.includes(id))
        .slice(0, 2_000)
    : [];
  const neighborPeople = ownerNeighbors.length
    ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, ownerNeighbors)).all()
    : [];
  const secondDegree: SecondDegreeConnection[] = [];
  for (const neighbor of neighborPeople) {
    const viaStrength = getContactRelationshipStrength(neighbor.id, options);
    for (const targetId of currentIds) {
      const kind = connectionKind(visibleEdges.filter((edge) => edgeTouches(edge, neighbor.id, targetId)));
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
  for (const row of strengthRows) bands[row.strength.band]++;
  const best = strengthRows
    .filter((row) => row.strength.score !== null)
    .sort((a, b) => (b.strength.score ?? 0) - (a.strength.score ?? 0))[0];
  const emailContactIds = new Set(emailRows.map((row) => row.contactId));
  const verifiedEmailContactIds = new Set(emailRows.filter((row) => row.isVerified).map((row) => row.contactId));

  return {
    people: {
      total: allIds.length,
      current: currentIds.length,
      former: [...new Set(employmentRows.filter((row) => !row.isCurrent).map((row) => row.contactId))].length,
    },
    coverage: {
      withEmail: emailContactIds.size,
      withVerifiedEmail: verifiedEmailContactIds.size,
      withIdentity: identityContactIds.size,
      withRelationship: strengthRows.filter((row) => row.strength.band !== "unknown").length,
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
