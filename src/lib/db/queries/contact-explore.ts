import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  graphEdges,
  identityMetrics,
  niches,
} from "@/lib/db/schema";
import { getActivePersona } from "@/lib/db/queries/personas";

export type ContactExplorePersona = {
  visibility: "shared" | "local_only" | "absent";
  archetype: string | null;
  tone: string | null;
  summary: string | null;
  interests: string[];
  confidence: number | null;
  generatedAt: number | null;
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

function latestMetricForIdentity(identityId: string) {
  return db
    .select()
    .from(identityMetrics)
    .where(eq(identityMetrics.contactIdentityId, identityId))
    .orderBy(desc(identityMetrics.snapshotAt))
    .limit(1)
    .get();
}

function sharedNichesForContact(contactId: string): ContactExploreNiche[] {
  const edges = db
    .select({
      nicheId: graphEdges.dstId,
      weight: graphEdges.weight,
    })
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

  const results: ContactExploreNiche[] = [];
  for (const edge of edges) {
    const niche = db.select().from(niches).where(eq(niches.id, edge.nicheId)).get();
    if (!niche || niche.scope !== "shared") continue;
    results.push({
      id: niche.id,
      name: niche.name,
      slug: niche.slug,
      nicheType: niche.nicheType,
      weight: edge.weight ?? null,
    });
  }
  return results;
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
    };
  }

  return {
    visibility: "shared",
    archetype: persona.archetype,
    tone: persona.tone,
    summary: persona.summary,
    interests: JSON.parse(persona.interests ?? "[]") as string[],
    confidence: persona.confidence,
    generatedAt: persona.generatedAt,
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

  const identities: ContactExploreIdentity[] = identityRows.map((identity) => {
    const latest = latestMetricForIdentity(identity.id);
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
