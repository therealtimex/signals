import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  graphEdges,
  identityMetrics,
  niches,
} from "@/lib/db/schema";
import { getActivePersona } from "@/lib/db/queries/personas";
import { isPersonaAgeStale } from "@/lib/persona/staleness";
import type { IdentityMetric } from "@/lib/db/types";

export type ContactExplorePersona = {
  visibility: "shared" | "local_only" | "absent";
  archetype: string | null;
  tone: string | null;
  summary: string | null;
  interests: string[];
  confidence: number | null;
  generatedAt: number | null;
  /** Age-only staleness on the read path; null when absent or local_only. */
  stale: boolean | null;
};

export type ContactExploreIdentity = {
  id: string;
  platform: string;
  platformHandle: string | null;
  displayName: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  listedCount: number | null;
  engagementRate: number | null;
  statsUpdatedAt: number | null;
  metricSnapshotAt: number | null;
};

export type ContactExploreNiche = {
  id: string;
  name: string;
  slug: string;
  nicheType: string;
  weight: number | null;
};

export type ContactExploreCard = {
  persona: ContactExplorePersona;
  identities: ContactExploreIdentity[];
  niches: ContactExploreNiche[];
};

/** Parse persona interests JSON; never throws. */
export function parsePersonaInterests(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
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

function sharedNichesForContact(contactId: string): ContactExploreNiche[] {
  return db
    .select({
      id: niches.id,
      name: niches.name,
      slug: niches.slug,
      nicheType: niches.nicheType,
      weight: graphEdges.weight,
    })
    .from(graphEdges)
    .innerJoin(niches, eq(graphEdges.dstId, niches.id))
    .where(
      and(
        eq(graphEdges.edgeType, "belongs_to_niche"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "niche"),
        eq(graphEdges.scope, "shared"),
        eq(niches.scope, "shared"),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      nicheType: row.nicheType,
      weight: row.weight ?? null,
    }));
}

function buildPersonaProjection(contactId: string): ContactExplorePersona {
  const persona = getActivePersona(contactId, { includeLocalOnly: true });

  if (!persona) {
    return {
      visibility: "absent",
      archetype: null,
      tone: null,
      summary: null,
      interests: [],
      confidence: null,
      generatedAt: null,
      stale: null,
    };
  }

  if (persona.scope === "local_only") {
    return {
      visibility: "local_only",
      archetype: null,
      tone: null,
      summary: null,
      interests: [],
      confidence: null,
      generatedAt: null,
      stale: null,
    };
  }

  return {
    visibility: "shared",
    archetype: persona.archetype,
    tone: persona.tone,
    summary: persona.summary,
    interests: parsePersonaInterests(persona.interests),
    confidence: persona.confidence,
    generatedAt: persona.generatedAt,
    stale: isPersonaAgeStale(persona.generatedAt),
  };
}

export function getContactExploreCard(contactId: string): ContactExploreCard | undefined {
  const contact = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return undefined;

  const identityRows = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all();

  const metricByIdentity = latestMetricsForIdentities(identityRows.map((identity) => identity.id));

  const identities: ContactExploreIdentity[] = identityRows.map((identity) => {
    const latest = metricByIdentity.get(identity.id);
    return {
      id: identity.id,
      platform: identity.platform,
      platformHandle: identity.platformHandle,
      displayName: identity.displayName,
      followersCount: latest?.followersCount ?? identity.followersCount,
      followingCount: latest?.followingCount ?? identity.followingCount,
      postsCount: latest?.postsCount ?? identity.postsCount,
      listedCount: latest?.listedCount ?? identity.listedCount,
      engagementRate: latest?.engagementRate ?? null,
      statsUpdatedAt: identity.statsUpdatedAt,
      metricSnapshotAt: latest?.snapshotAt ?? null,
    };
  });

  return {
    persona: buildPersonaProjection(contactId),
    identities,
    niches: sharedNichesForContact(contactId),
  };
}
