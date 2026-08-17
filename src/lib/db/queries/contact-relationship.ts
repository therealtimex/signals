import { and, eq, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { graphEdges } from "@/lib/db/schema";
import type { GraphEdge } from "@/lib/db/types";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { upsertGraphEdge } from "@/lib/db/queries/graph";

export type RelationshipStage =
  | "stranger"
  | "acquaintance"
  | "warm"
  | "close"
  | "inner_circle";

export type RelationshipProperties = {
  relationshipType?: "professional" | "personal" | "mixed";
  stage?: RelationshipStage;
  lastMeaningfulInteraction?: number | null;
  desiredDirection?: string | null;
  context?: string | null;
};

export type ContactRelationshipDTO = {
  edgeId: string;
  ownerContactId: string;
  contactId: string;
  stage: RelationshipStage | null;
  warmth: number | null;
  notes: string | null;
  relationshipType: RelationshipProperties["relationshipType"] | null;
  lastMeaningfulInteraction: number | null;
  desiredDirection: string | null;
  context: string | null;
};

function parseProperties(raw: string | null): RelationshipProperties {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RelationshipProperties;
  } catch {
    return {};
  }
}

function findRelationshipEdge(
  ownerId: string,
  contactId: string,
): GraphEdge | undefined {
  return db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "relationship"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "contact"),
        or(
          and(eq(graphEdges.srcId, ownerId), eq(graphEdges.dstId, contactId)),
          and(eq(graphEdges.srcId, contactId), eq(graphEdges.dstId, ownerId)),
        ),
      ),
    )
    .get();
}

export function getContactRelationship(contactId: string): ContactRelationshipDTO | null {
  const ownerId = getOwnerContactId();
  if (!ownerId || ownerId === contactId) return null;

  const edge = findRelationshipEdge(ownerId, contactId);
  if (!edge) return null;

  const props = parseProperties(edge.properties);
  return {
    edgeId: edge.id,
    ownerContactId: ownerId,
    contactId,
    stage: props.stage ?? null,
    warmth: edge.weight ?? null,
    notes: edge.propertiesPrivate ?? null,
    relationshipType: props.relationshipType ?? null,
    lastMeaningfulInteraction: props.lastMeaningfulInteraction ?? null,
    desiredDirection: props.desiredDirection ?? null,
    context: props.context ?? null,
  };
}

export type UpsertContactRelationshipInput = {
  contactId: string;
  stage?: RelationshipStage | null;
  warmth?: number | null;
  notes?: string | null;
  relationshipType?: RelationshipProperties["relationshipType"] | null;
  desiredDirection?: string | null;
  context?: string | null;
};

export function upsertContactRelationship(
  input: UpsertContactRelationshipInput,
): ContactRelationshipDTO {
  const ownerId = getOwnerContactId();
  if (!ownerId) {
    throw new Error("Owner contact is not configured");
  }
  if (ownerId === input.contactId) {
    throw new Error("Cannot create a relationship edge with yourself");
  }

  const existing = findRelationshipEdge(ownerId, input.contactId);
  const existingProps = parseProperties(existing?.properties ?? null);

  const properties: RelationshipProperties = {
    ...existingProps,
    relationshipType:
      input.relationshipType === undefined
        ? existingProps.relationshipType
        : (input.relationshipType ?? undefined),
    stage: input.stage === undefined ? existingProps.stage : (input.stage ?? undefined),
    desiredDirection:
      input.desiredDirection === undefined
        ? existingProps.desiredDirection
        : (input.desiredDirection ?? undefined),
    context: input.context === undefined ? existingProps.context : (input.context ?? undefined),
    lastMeaningfulInteraction: existingProps.lastMeaningfulInteraction ?? null,
  };

  const edge = upsertGraphEdge({
    srcType: "contact",
    srcId: ownerId,
    dstType: "contact",
    dstId: input.contactId,
    edgeType: "relationship",
    weight: input.warmth === undefined ? (existing?.weight ?? null) : input.warmth,
    properties: JSON.stringify(properties),
    propertiesPrivate:
      input.notes === undefined ? (existing?.propertiesPrivate ?? null) : input.notes,
    scope: "local_only",
    source: "api:relationship",
  });

  const props = parseProperties(edge.properties);
  return {
    edgeId: edge.id,
    ownerContactId: ownerId,
    contactId: input.contactId,
    stage: props.stage ?? null,
    warmth: edge.weight ?? null,
    notes: edge.propertiesPrivate ?? null,
    relationshipType: props.relationshipType ?? null,
    lastMeaningfulInteraction: props.lastMeaningfulInteraction ?? null,
    desiredDirection: props.desiredDirection ?? null,
    context: props.context ?? null,
  };
}

/** Bump `last_meaningful_interaction` on the owner↔contact relationship edge. */
export function touchRelationshipLastMeaningfulInteraction(
  contactId: string,
  occurredAt: number,
  runner: DbRunner = db,
): void {
  const ownerId = getOwnerContactId();
  if (!ownerId || ownerId === contactId) return;

  const existing = runner
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "relationship"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "contact"),
        eq(graphEdges.srcId, ownerId),
        eq(graphEdges.dstId, contactId),
      ),
    )
    .get();

  const props = parseProperties(existing?.properties ?? null);
  if (props.lastMeaningfulInteraction && props.lastMeaningfulInteraction >= occurredAt) {
    return;
  }

  const nextProps: RelationshipProperties = {
    ...props,
    lastMeaningfulInteraction: occurredAt,
  };

  if (existing) {
    runner
      .update(graphEdges)
      .set({
        properties: JSON.stringify(nextProps),
        lastSeenAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(graphEdges.id, existing.id))
      .run();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  runner
    .insert(graphEdges)
    .values({
      id: nanoid(),
      srcType: "contact",
      srcId: ownerId,
      dstType: "contact",
      dstId: contactId,
      edgeType: "relationship",
      weight: null,
      properties: JSON.stringify(nextProps),
      propertiesPrivate: null,
      scope: "local_only",
      source: "interaction:meaningful",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
