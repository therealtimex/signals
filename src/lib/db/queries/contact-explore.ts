import { and, asc, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contacts,
  contentItems,
  contentPosts,
  graphEdges,
  identityMetrics,
  niches,
  orgs,
} from "@/lib/db/schema";
import { getOwnerContactId } from "@/lib/db/queries/contacts";
import { loadContactAvatarUploadAssetId, resolveContactPrimaryEmail } from "@/lib/db/queries/contact-dto";
import { getActivePersona } from "@/lib/db/queries/personas";
import { resolveContactAvatar } from "@/lib/db/queries/resolve-contact-avatar";
import { resolveContactProfile } from "@/lib/db/queries/resolve-contact-profile";
import { isPersonaAgeStale } from "@/lib/persona/staleness";
import type { ContactIdentity, IdentityMetric } from "@/lib/db/types";

export type ContactExploreContact = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  headline: string | null;
  avatarUrl: string | null;
  location: string | null;
  relationshipGoal?: string | null;
  relationshipGoalStatus?: string | null;
};

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
  conversionTriggers: string[];
  engagementFormats: string[];
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
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  isVerified: boolean | null;
  platformCreatedAt: number | null;
  platformUrl: string | null;
  isPrimary: boolean;
  createdAt: number;
};

export type ContactExploreNiche = {
  id: string;
  name: string;
  slug: string;
  nicheType: string;
  weight: number | null;
};

export type ContactExploreRelationship = {
  label: "Follower" | "Following" | "Mutual" | "Connected";
  edgeType: "follows" | "connected_to";
};

export type ContactExploreOrg = {
  id: string;
  name: string;
  domain: string | null;
  avatarUrl: string | null;
};

export type ContactExploreRecentPost = {
  id: string;
  contentType: string;
  platform: string | null;
  text: string;
  url: string | null;
  publishedAt: number | null;
};

export type ContactExploreCard = {
  contact: ContactExploreContact;
  persona: ContactExplorePersona;
  identities: ContactExploreIdentity[];
  niches: ContactExploreNiche[];
  relationship: ContactExploreRelationship | null;
  org: ContactExploreOrg | null;
  recentPosts: ContactExploreRecentPost[];
};

const RECENT_POSTS_LIMIT = 5;
const POST_TEXT_MAX = 280;
const PRIVATE_CONTENT_TYPES = ["dm", "email"] as const;

/** Parse persona JSON string arrays; never throws. */
export function parsePersonaInterests(raw: string | null | undefined): string[] {
  return parsePersonaJsonStringArray(raw);
}

export function parsePersonaJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function truncateExplorePostText(
  title: string | null | undefined,
  body: string | null | undefined,
  max = POST_TEXT_MAX,
): string | null {
  const text = (title ?? body ?? "").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function latestMetricsForIdentities(identityIds: string[]): Map<string, IdentityMetric> {
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

/** Max followers across identities; snapshot metric wins over denormalized column (ui-4.2 §2). */
export function maxFollowersCountByContactIds(
  contactIds: string[],
): Map<string, number | null> {
  const result = new Map<string, number | null>();
  if (contactIds.length === 0) return result;

  for (const contactId of contactIds) {
    result.set(contactId, null);
  }

  const identityRows = db
    .select()
    .from(contactIdentities)
    .where(inArray(contactIdentities.contactId, contactIds))
    .all();

  const metricByIdentity = latestMetricsForIdentities(identityRows.map((identity) => identity.id));

  for (const identity of identityRows) {
    const latest = metricByIdentity.get(identity.id);
    const count = latest?.followersCount ?? identity.followersCount ?? null;
    if (count === null) continue;
    const current = result.get(identity.contactId) ?? null;
    if (current === null || count > current) {
      result.set(identity.contactId, count);
    }
  }

  return result;
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
      conversionTriggers: [],
      engagementFormats: [],
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
      conversionTriggers: [],
      engagementFormats: [],
    };
  }

  return {
    visibility: "shared",
    archetype: persona.archetype,
    tone: persona.tone,
    summary: persona.summary,
    interests: parsePersonaJsonStringArray(persona.interests),
    confidence: persona.confidence,
    generatedAt: persona.generatedAt,
    stale: isPersonaAgeStale(persona.generatedAt),
    conversionTriggers: parsePersonaJsonStringArray(persona.conversionTriggers),
    engagementFormats: parsePersonaJsonStringArray(persona.engagementFormats),
  };
}

function mapIdentityRow(
  identity: ContactIdentity,
  latest: IdentityMetric | undefined,
): ContactExploreIdentity {
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
    avatarUrl: identity.avatarUrl,
    bio: identity.bio,
    location: identity.location,
    isVerified: identity.isVerified ?? null,
    platformCreatedAt: identity.platformCreatedAt,
    platformUrl: identity.platformUrl,
    isPrimary: Boolean(identity.isPrimary),
    createdAt: identity.createdAt,
  };
}

export function deriveRelationship(
  contactId: string,
  ownerId: string | null,
): ContactExploreRelationship | null {
  if (!ownerId || contactId === ownerId) return null;

  const edges = db
    .select()
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.dstType, "contact"),
        eq(graphEdges.scope, "shared"),
        or(
          and(eq(graphEdges.srcId, contactId), eq(graphEdges.dstId, ownerId)),
          and(eq(graphEdges.srcId, ownerId), eq(graphEdges.dstId, contactId)),
        ),
        or(eq(graphEdges.edgeType, "follows"), eq(graphEdges.edgeType, "connected_to")),
      ),
    )
    .all();

  const contactFollowsOwner = edges.some(
    (edge) =>
      edge.edgeType === "follows" && edge.srcId === contactId && edge.dstId === ownerId,
  );
  const ownerFollowsContact = edges.some(
    (edge) =>
      edge.edgeType === "follows" && edge.srcId === ownerId && edge.dstId === contactId,
  );
  const connected = edges.some((edge) => edge.edgeType === "connected_to");

  if (contactFollowsOwner && ownerFollowsContact) {
    return { label: "Mutual", edgeType: "follows" };
  }
  if (contactFollowsOwner) {
    return { label: "Follower", edgeType: "follows" };
  }
  if (ownerFollowsContact) {
    return { label: "Following", edgeType: "follows" };
  }
  if (connected) {
    return { label: "Connected", edgeType: "connected_to" };
  }
  return null;
}

function primaryOrgForContact(contactId: string): ContactExploreOrg | null {
  const rows = db
    .select({
      id: orgs.id,
      name: orgs.name,
      domain: orgs.domain,
      avatarUrl: orgs.avatarUrl,
      lastSeenAt: graphEdges.lastSeenAt,
      weight: graphEdges.weight,
    })
    .from(graphEdges)
    .innerJoin(orgs, eq(graphEdges.dstId, orgs.id))
    .where(
      and(
        eq(graphEdges.edgeType, "works_at"),
        eq(graphEdges.srcType, "contact"),
        eq(graphEdges.srcId, contactId),
        eq(graphEdges.dstType, "org"),
        eq(graphEdges.scope, "shared"),
        eq(orgs.scope, "shared"),
      ),
    )
    .all();

  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => {
    const aSeen = a.lastSeenAt ?? 0;
    const bSeen = b.lastSeenAt ?? 0;
    if (bSeen !== aSeen) return bSeen - aSeen;
    const aWeight = a.weight ?? Number.NEGATIVE_INFINITY;
    const bWeight = b.weight ?? Number.NEGATIVE_INFINITY;
    if (bWeight !== aWeight) return bWeight - aWeight;
    return a.name.localeCompare(b.name);
  });

  const top = sorted[0];
  if (!top) return null;
  return {
    id: top.id,
    name: top.name,
    domain: top.domain,
    avatarUrl: top.avatarUrl,
  };
}

function selectPreferredContentPost(
  posts: Array<{ platformUrl: string | null; publishedAt: number | null }>,
  itemCreatedAt: number,
): { url: string | null; publishedAt: number } {
  if (posts.length === 0) {
    return { url: null, publishedAt: itemCreatedAt };
  }

  const withUrl = posts.filter((post) => post.platformUrl);
  const pool = withUrl.length > 0 ? withUrl : posts;
  const preferred = [...pool].sort(
    (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
  )[0];

  return {
    url: preferred?.platformUrl ?? null,
    publishedAt: preferred?.publishedAt ?? itemCreatedAt,
  };
}

function recentPostsForContact(contactId: string): ContactExploreRecentPost[] {
  const items = db
    .select()
    .from(contentItems)
    .where(
      and(
        eq(contentItems.contactId, contactId),
        or(eq(contentItems.origin, "received"), eq(contentItems.origin, "imported")),
        notInArray(contentItems.contentType, [...PRIVATE_CONTENT_TYPES]),
      ),
    )
    .orderBy(desc(contentItems.createdAt))
    .all();

  if (items.length === 0) return [];

  const itemIds = items.map((item) => item.id);
  const postRows =
    itemIds.length > 0
      ? db
          .select({
            contentItemId: contentPosts.contentItemId,
            platformUrl: contentPosts.platformUrl,
            publishedAt: contentPosts.publishedAt,
          })
          .from(contentPosts)
          .where(inArray(contentPosts.contentItemId, itemIds))
          .all()
      : [];

  const postsByItem = new Map<string, Array<{ platformUrl: string | null; publishedAt: number | null }>>();
  for (const post of postRows) {
    const list = postsByItem.get(post.contentItemId) ?? [];
    list.push({ platformUrl: post.platformUrl, publishedAt: post.publishedAt });
    postsByItem.set(post.contentItemId, list);
  }

  const assembled = items
    .map((item) => {
      const text = truncateExplorePostText(item.title, item.body);
      if (!text) return null;
      const itemPosts = postsByItem.get(item.id) ?? [];
      const { url, publishedAt } = selectPreferredContentPost(itemPosts, item.createdAt);
      return {
        id: item.id,
        contentType: item.contentType,
        platform: item.platformTarget,
        text,
        url,
        publishedAt,
        sortAt: publishedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => b.sortAt - a.sortAt)
    .slice(0, RECENT_POSTS_LIMIT)
    .map(({ sortAt: _sortAt, ...post }) => post);

  return assembled;
}

export function getContactExploreCard(contactId: string): ContactExploreCard | undefined {
  const contactRow = db
    .select({
      id: contacts.id,
      name: contacts.name,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      relationshipGoal: contacts.relationshipGoal,
      relationshipGoalStatus: contacts.relationshipGoalStatus,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  if (!contactRow) return undefined;

  const identityRows = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .orderBy(desc(contactIdentities.isPrimary), desc(contactIdentities.followersCount), asc(contactIdentities.createdAt))
    .all();

  const metricByIdentity = latestMetricsForIdentities(identityRows.map((identity) => identity.id));

  const identities = identityRows.map((identity) =>
    mapIdentityRow(identity, metricByIdentity.get(identity.id)),
  );

  const ownerId = getOwnerContactId();
  const profile = resolveContactProfile({ identities: identityRows });
  const avatarUrl = resolveContactAvatar({
    avatarUploadAssetId: loadContactAvatarUploadAssetId(contactId),
    identities: identityRows,
    primaryEmail: resolveContactPrimaryEmail(contactId),
  });
  const org = primaryOrgForContact(contactId);

  return {
    contact: {
      id: contactRow.id,
      name: contactRow.name,
      firstName: contactRow.firstName,
      lastName: contactRow.lastName,
      company: org?.name ?? null,
      title: profile.headline ?? null,
      headline: profile.headline,
      avatarUrl,
      location: profile.location,
      relationshipGoal: contactRow.relationshipGoal,
      relationshipGoalStatus: contactRow.relationshipGoalStatus,
    },
    persona: buildPersonaProjection(contactId),
    identities,
    niches: sharedNichesForContact(contactId),
    relationship: deriveRelationship(contactId, ownerId),
    org,
    recentPosts: recentPostsForContact(contactId),
  };
}
