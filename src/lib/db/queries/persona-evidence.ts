import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  contentItems,
  contentPosts,
  graphEdges,
  identityMetrics,
  interactions,
  niches,
  orgs,
} from "@/lib/db/schema";
import type { IdentityMetric } from "@/lib/db/types";
import { PersonaEvidenceError } from "@/lib/db/queries/persona-errors";

export const MAX_EVIDENCE_CHARS = 24_000;
export const MAX_PERSONA_CONTENT_ITEMS = 20;
export const MAX_PERSONA_INTERACTIONS = 20;
export const MAX_PERSONA_CONTENT_BODY_CHARS = 500;

export type PersonaEvidence = {
  contact: {
    name: string;
    title: string | null;
    company: string | null;
    location: string | null;
    bio: string | null;
  };
  identities: Array<{
    platform: string;
    platformHandle: string | null;
    displayName: string | null;
    bio: string | null;
    isVerified: boolean | null;
    followersCount: number | null;
    followingCount: number | null;
    postsCount: number | null;
    platformCreatedAt: number | null;
    engagementRate: number | null;
    metricSnapshotAt: number | null;
  }>;
  content: Array<{
    contentType: string;
    title: string | null;
    body: string;
    publishedAt: number;
  }>;
  interactions: Array<{
    interactionType: string;
    direction: string | null;
    summary: string | null;
    isMeaningful: boolean;
    occurredAt: number;
  }>;
  org: {
    name: string;
    orgType: string;
    domain: string | null;
    description: string | null;
  } | null;
  niches: Array<{
    name: string;
    nicheType: string;
    weight: number | null;
  }>;
};

export type PersonaEvidenceProvenance = {
  identityIds: string[];
  metricSnapshotAt: Record<string, number>;
  contentItemIds: string[];
  interactionWindow: { sharedCount: number; from: number; to: number } | null;
  orgIds: string[];
  nicheSlugs: string[];
  evidenceHash: string;
  assembledAt: number;
};

export type PersonaEvidenceBundle = {
  evidence: PersonaEvidence;
  provenance: PersonaEvidenceProvenance;
};

type InternalContentRow = PersonaEvidence["content"][number] & { id: string };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashPersonaEvidence(evidence: PersonaEvidence): string {
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

function truncateBody(body: string | null | undefined): string {
  const text = body?.trim() ?? "";
  if (text.length <= MAX_PERSONA_CONTENT_BODY_CHARS) return text;
  return text.slice(0, MAX_PERSONA_CONTENT_BODY_CHARS);
}

function trimEvidenceToBudget(evidence: PersonaEvidence): PersonaEvidence {
  const trimmed: PersonaEvidence = {
    ...evidence,
    content: [...evidence.content],
    interactions: [...evidence.interactions],
  };

  while (JSON.stringify(trimmed).length > MAX_EVIDENCE_CHARS && trimmed.content.length > 0) {
    trimmed.content.pop();
  }
  while (JSON.stringify(trimmed).length > MAX_EVIDENCE_CHARS && trimmed.interactions.length > 0) {
    trimmed.interactions.pop();
  }
  return trimmed;
}

function latestMetricsForIdentities(identityIds: string[]): Map<string, IdentityMetric> {
  if (identityIds.length === 0) return new Map();

  const rows = db
    .select()
    .from(identityMetrics)
    .where(inArray(identityMetrics.contactIdentityId, identityIds))
    .orderBy(desc(identityMetrics.snapshotAt))
    .all();

  const latest = new Map<string, IdentityMetric>();
  for (const row of rows) {
    if (!latest.has(row.contactIdentityId)) {
      latest.set(row.contactIdentityId, row);
    }
  }
  return latest;
}

function primarySharedOrg(contactId: string): { id: string; name: string; orgType: string; domain: string | null; description: string | null } | null {
  const edge = db
    .select({ orgId: graphEdges.dstId })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "works_at"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "org"),
        eq(graphEdges.scope, "shared"),
      ),
    )
    .get();
  if (!edge) return null;

  const org = db.select().from(orgs).where(eq(orgs.id, edge.orgId)).get();
  if (!org || org.scope !== "shared") return null;

  return {
    id: org.id,
    name: org.name,
    orgType: org.orgType,
    domain: org.domain,
    description: org.description,
  };
}

function sharedNichesForContact(contactId: string): Array<{ slug: string; name: string; nicheType: string; weight: number | null }> {
  const edges = db
    .select({ nicheId: graphEdges.dstId, weight: graphEdges.weight, source: graphEdges.source })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "niche"),
        eq(graphEdges.scope, "shared"),
      ),
    )
    .all();

  const results: Array<{ slug: string; name: string; nicheType: string; weight: number | null }> = [];
  for (const edge of edges) {
    // Persona-generation side effects are outputs, not independent input evidence.
    if (edge.source?.startsWith("persona:")) continue;

    const niche = db.select().from(niches).where(eq(niches.id, edge.nicheId)).get();
    if (!niche || niche.scope !== "shared") continue;
    results.push({
      slug: niche.slug,
      name: niche.name,
      nicheType: niche.nicheType,
      weight: edge.weight ?? null,
    });
  }
  return results;
}

function sharedInteractionCount(contactId: string): number {
  return (
    db
      .select({ value: count() })
      .from(interactions)
      .where(and(eq(interactions.contactId, contactId), eq(interactions.scope, "shared")))
      .get()?.value ?? 0
  );
}

function assertEvidenceSufficiency(
  identityCount: number,
  contentCount: number,
  sharedInteractions: number,
): void {
  if (identityCount >= 1 || contentCount >= 1 || sharedInteractions >= 3) return;
  throw new PersonaEvidenceError(
    "Insufficient evidence to generate a persona — connect a platform identity, sync public posts, or log shared interactions",
  );
}

/** Allowlist projection for persona synthesis — shared-scope surfaces only. */
export function assemblePersonaEvidence(contactId: string): PersonaEvidenceBundle {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const identityRows = db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.isActive, 1)))
    .all();

  const metricByIdentity = latestMetricsForIdentities(identityRows.map((row) => row.id));

  const identities = identityRows.map((identity) => {
    const latest = metricByIdentity.get(identity.id);
    return {
      platform: identity.platform,
      platformHandle: identity.platformHandle,
      displayName: identity.displayName,
      bio: identity.bio,
      isVerified: identity.isVerified,
      followersCount: latest?.followersCount ?? identity.followersCount,
      followingCount: latest?.followingCount ?? identity.followingCount,
      postsCount: latest?.postsCount ?? identity.postsCount,
      platformCreatedAt: identity.platformCreatedAt,
      engagementRate: latest?.engagementRate ?? null,
      metricSnapshotAt: latest?.snapshotAt ?? null,
    };
  });

  const contentRows = db
    .select({
      id: contentItems.id,
      contentType: contentItems.contentType,
      title: contentItems.title,
      body: contentItems.body,
      publishedAt: contentPosts.publishedAt,
    })
    .from(contentItems)
    .innerJoin(contentPosts, eq(contentPosts.contentItemId, contentItems.id))
    .where(
      and(
        eq(contentItems.contactId, contactId),
        notInArray(contentItems.contentType, ["email", "dm"]),
        isNotNull(contentPosts.publishedAt),
      ),
    )
    .orderBy(desc(contentPosts.publishedAt))
    .limit(MAX_PERSONA_CONTENT_ITEMS)
    .all();

  const internalContent: InternalContentRow[] = contentRows
    .filter((row) => row.publishedAt !== null)
    .map((row) => ({
      id: row.id,
      contentType: row.contentType,
      title: row.title,
      body: truncateBody(row.body),
      publishedAt: row.publishedAt!,
    }));

  const interactionRows = db
    .select()
    .from(interactions)
    .where(and(eq(interactions.contactId, contactId), eq(interactions.scope, "shared")))
    .orderBy(desc(interactions.occurredAt))
    .limit(MAX_PERSONA_INTERACTIONS)
    .all();

  const sharedCount = sharedInteractionCount(contactId);
  assertEvidenceSufficiency(identityRows.length, internalContent.length, sharedCount);

  const orgRecord = primarySharedOrg(contactId);
  const nicheRows = sharedNichesForContact(contactId);

  const evidenceDraft: PersonaEvidence = {
    contact: {
      name: contact.name,
      title: contact.title,
      company: contact.company,
      location: contact.location,
      bio: contact.bio,
    },
    identities,
    content: internalContent.map(({ id: _id, ...row }) => row),
    interactions: interactionRows.map((row) => ({
      interactionType: row.interactionType,
      direction: row.direction,
      summary: row.summary,
      isMeaningful: row.isMeaningful,
      occurredAt: row.occurredAt,
    })),
    org: orgRecord
      ? {
          name: orgRecord.name,
          orgType: orgRecord.orgType,
          domain: orgRecord.domain,
          description: orgRecord.description,
        }
      : null,
    niches: nicheRows.map((row) => ({
      name: row.name,
      nicheType: row.nicheType,
      weight: row.weight,
    })),
  };

  const trimmed = trimEvidenceToBudget(evidenceDraft);
  const trimmedContentIds = internalContent.slice(0, trimmed.content.length).map((row) => row.id);
  const trimmedInteractions = interactionRows.slice(0, trimmed.interactions.length);

  const interactionWindow =
    trimmedInteractions.length > 0
      ? {
          sharedCount,
          from: Math.min(...trimmedInteractions.map((row) => row.occurredAt)),
          to: Math.max(...trimmedInteractions.map((row) => row.occurredAt)),
        }
      : sharedCount > 0
        ? { sharedCount, from: 0, to: 0 }
        : null;

  const metricSnapshotAt: Record<string, number> = {};
  for (const identity of identityRows) {
    const snapshotAt = identities.find((_, index) => identityRows[index]?.id === identity.id)?.metricSnapshotAt;
    if (snapshotAt != null) {
      metricSnapshotAt[identity.id] = snapshotAt;
    }
  }

  const assembledAt = Math.floor(Date.now() / 1000);

  return {
    evidence: trimmed,
    provenance: {
      identityIds: identityRows.map((row) => row.id),
      metricSnapshotAt,
      contentItemIds: trimmedContentIds,
      interactionWindow,
      orgIds: orgRecord ? [orgRecord.id] : [],
      nicheSlugs: nicheRows.map((row) => row.slug),
      evidenceHash: hashPersonaEvidence(trimmed),
      assembledAt,
    },
  };
}

export function renderPersonaEvidencePrompt(evidence: PersonaEvidence): string {
  return JSON.stringify(evidence);
}
