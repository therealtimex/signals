/**
 * Multi-tier duplicate contact detection (#209).
 *
 * Tier 1 - exact claim: same normalized email, or same (platform, handle).
 * Tier 2 - fuzzy identity: same/near name plus the same employer.
 * Tier 3 - graph overlap: shared employment node plus overlapping interaction threads.
 *
 * Detection is read-only and returns *candidates*. Nothing merges until
 * `mergeContacts` is called with an explicit primary.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contacts,
  interactions,
  orgs,
} from "@/lib/db/schema";
import {
  identityClaimKey,
  isRoleAccountEmail,
  nameSimilarity,
  orgNameKey,
  personNameKey,
} from "./normalize";

export type DuplicateTier = 1 | 2 | 3;

/** Lower bound for a Tier 2 name match. Below this the pair is not proposed at all. */
const TIER2_NAME_FLOOR = 0.8;
/** Tier 3 tolerates a weaker name because the graph is carrying the evidence. */
const TIER3_NAME_FLOOR = 0.5;
const DEFAULT_LIMIT = 50;
/** Guard against pathological graphs; detection is interactive, not a batch job. */
const MAX_SCANNED_CONTACTS = 5000;

export interface DuplicateGroupMember {
  contactId: string;
  name: string;
  enrichmentScore: number;
  identityCount: number;
  createdAt: number;
  /** The workspace owner can never be merged away, so it always wins the primary pick. */
  isSelf: boolean;
}

export interface DuplicateCandidate {
  /** Suggested survivor, chosen by `pickPrimary`. Callers may override. */
  primaryContactId: string;
  secondaryContactIds: string[];
  tier: DuplicateTier;
  /** 0..1. Tier 1 is always 1. */
  confidence: number;
  reason: string;
  members: DuplicateGroupMember[];
}

export interface FindDuplicatesOptions {
  tiers?: DuplicateTier[];
  minConfidence?: number;
  limit?: number;
  /** Restrict detection to this set (used by the CLI to re-check a staged file). */
  contactIds?: string[];
}

interface ContactFacts {
  id: string;
  name: string;
  enrichmentScore: number;
  createdAt: number;
  isSelf: boolean;
  nameKey: string;
  emailKeys: Set<string>;
  handleKeys: Set<string>;
  claimKeys: Set<string>;
  orgIds: Set<string>;
  orgKeys: Set<string>;
  threadKeys: Set<string>;
  identityCount: number;
}

/** Pairwise evidence, keyed by the unordered contact pair. */
interface PairEvidence {
  a: string;
  b: string;
  tier: DuplicateTier;
  confidence: number;
  reason: string;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

function loadContactFacts(contactIds?: string[]): Map<string, ContactFacts> {
  const liveFilters = [
    sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`,
    sql`json_extract(${contacts.metadata}, '$.platformActor') IS NOT 1`,
  ];
  const where = contactIds?.length
    ? and(inArray(contacts.id, contactIds), ...liveFilters)
    : and(...liveFilters);

  const rows = db
    .select({
      id: contacts.id,
      name: contacts.name,
      enrichmentScore: contacts.enrichmentScore,
      createdAt: contacts.createdAt,
      isSelf: contacts.isSelf,
    })
    .from(contacts)
    .where(where)
    // Ordered so which rows survive MAX_SCANNED_CONTACTS truncation is stable
    // across runs rather than left to SQLite's scan order.
    .orderBy(contacts.createdAt, contacts.id)
    .limit(MAX_SCANNED_CONTACTS)
    .all();

  const facts = new Map<string, ContactFacts>();
  for (const row of rows) {
    facts.set(row.id, {
      id: row.id,
      name: row.name,
      enrichmentScore: row.enrichmentScore,
      createdAt: row.createdAt,
      isSelf: row.isSelf,
      nameKey: personNameKey(row.name),
      emailKeys: new Set(),
      handleKeys: new Set(),
      claimKeys: new Set(),
      orgIds: new Set(),
      orgKeys: new Set(),
      threadKeys: new Set(),
      identityCount: 0,
    });
  }
  if (facts.size === 0) return facts;

  const ids = [...facts.keys()];

  for (const identity of db
    .select({
      contactId: contactIdentities.contactId,
      platform: contactIdentities.platform,
      platformUserId: contactIdentities.platformUserId,
      platformHandle: contactIdentities.platformHandle,
    })
    .from(contactIdentities)
    .where(inArray(contactIdentities.contactId, ids))
    .all()) {
    const fact = facts.get(identity.contactId);
    if (!fact) continue;
    fact.identityCount += 1;
    fact.claimKeys.add(identityClaimKey(identity.platform, identity.platformUserId));
    if (identity.platformHandle) {
      const handle = identity.platformHandle.trim().replace(/^@/, "").toLowerCase();
      if (handle) fact.handleKeys.add(`${identity.platform}:${handle}`);
    }
  }

  for (const channel of db
    .select({
      contactId: contactChannels.contactId,
      valueNormalized: contactChannels.valueNormalized,
    })
    .from(contactChannels)
    .where(and(inArray(contactChannels.contactId, ids), eq(contactChannels.channelType, "email")))
    .all()) {
    // A shared inbox says nothing about identity, so it never becomes tier 1
    // evidence. Two people at one company really can both carry info@acme.com.
    if (isRoleAccountEmail(channel.valueNormalized)) continue;
    facts.get(channel.contactId)?.emailKeys.add(channel.valueNormalized);
  }

  for (const employment of db
    .select({
      contactId: contactEmployments.contactId,
      orgId: contactEmployments.orgId,
      orgName: orgs.name,
    })
    .from(contactEmployments)
    .innerJoin(orgs, eq(orgs.id, contactEmployments.orgId))
    .where(and(inArray(contactEmployments.contactId, ids), eq(contactEmployments.isCurrent, true)))
    .all()) {
    const fact = facts.get(employment.contactId);
    if (!fact) continue;
    fact.orgIds.add(employment.orgId);
    const key = orgNameKey(employment.orgName);
    if (key) fact.orgKeys.add(key);
  }

  for (const interaction of db
    .select({
      contactId: interactions.contactId,
      contentItemId: interactions.contentItemId,
      contentPostId: interactions.contentPostId,
    })
    .from(interactions)
    .where(inArray(interactions.contactId, ids))
    .all()) {
    const fact = facts.get(interaction.contactId);
    if (!fact) continue;
    if (interaction.contentItemId) fact.threadKeys.add(`item:${interaction.contentItemId}`);
    if (interaction.contentPostId) fact.threadKeys.add(`post:${interaction.contentPostId}`);
  }

  return facts;
}

function hasIntersection(left: Set<string>, right: Set<string>): boolean {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) {
    if (large.has(value)) return true;
  }
  return false;
}

/** Tier 1: an exact shared claim. Email first because it is the stronger signal. */
function tier1Evidence(a: ContactFacts, b: ContactFacts): PairEvidence | null {
  if (hasIntersection(a.emailKeys, b.emailKeys)) {
    return { a: a.id, b: b.id, tier: 1, confidence: 1, reason: "Shared normalized email address" };
  }
  // The `idx_identity_platform_user` unique index makes a shared (platform,
  // platformUserId) impossible across two live contacts, so this only fires for
  // data that predates the index or arrives through a raw write path.
  if (hasIntersection(a.claimKeys, b.claimKeys)) {
    return {
      a: a.id,
      b: b.id,
      tier: 1,
      confidence: 1,
      reason: "Shared platform identity claim (platform + platformUserId)",
    };
  }
  if (hasIntersection(a.handleKeys, b.handleKeys)) {
    return {
      a: a.id,
      b: b.id,
      tier: 1,
      confidence: 1,
      reason: "Shared platform handle on the same platform",
    };
  }
  return null;
}

/** Tier 2: same person, same employer, spelled differently, or exact name collision with sparse records. */
function tier2Evidence(a: ContactFacts, b: ContactFacts): PairEvidence | null {
  if (hasIntersection(a.orgKeys, b.orgKeys)) {
    if (a.nameKey && a.nameKey === b.nameKey) {
      return {
        a: a.id,
        b: b.id,
        tier: 2,
        confidence: 0.95,
        reason: "Identical normalized name at the same organization",
      };
    }

    const similarity = nameSimilarity(a.name, b.name);
    if (similarity >= TIER2_NAME_FLOOR) {
      // Map [0.8, 1] onto [0.8, 0.95] so Tier 2 never claims Tier 1 certainty.
      const confidence =
        0.8 + ((similarity - TIER2_NAME_FLOOR) / (1 - TIER2_NAME_FLOOR)) * (0.95 - 0.8);
      return {
        a: a.id,
        b: b.id,
        tier: 2,
        confidence: Number(confidence.toFixed(3)),
        reason: `Similar name (${similarity.toFixed(2)}) at the same organization`,
      };
    }
  }

  // Exact multi-token name match where at least one record has no organization or 0 identities,
  // provided neither has an explicit conflicting organization.
  if (
    a.nameKey &&
    a.nameKey === b.nameKey &&
    a.nameKey.includes(" ") &&
    !(a.orgKeys.size > 0 && b.orgKeys.size > 0) &&
    (a.identityCount === 0 || b.identityCount === 0 || (a.orgKeys.size === 0 && b.orgKeys.size === 0))
  ) {
    return {
      a: a.id,
      b: b.id,
      tier: 2,
      confidence: 0.85,
      reason: "Identical normalized name with sparse secondary record",
    };
  }

  return null;
}

/** Tier 3: the graph, not the strings, is the evidence. */
function tier3Evidence(a: ContactFacts, b: ContactFacts): PairEvidence | null {
  if (!hasIntersection(a.orgIds, b.orgIds)) return null;
  if (!hasIntersection(a.threadKeys, b.threadKeys)) return null;
  const similarity = nameSimilarity(a.name, b.name);
  if (similarity < TIER3_NAME_FLOOR) return null;
  return {
    a: a.id,
    b: b.id,
    tier: 3,
    confidence: Number((0.5 + similarity * 0.2).toFixed(3)),
    reason: "Shared employment node and overlapping interaction threads",
  };
}

/**
 * Survivor rule from #209: highest enrichment score, then most linked
 * identities, then oldest record. Contact id is the final tiebreak so the
 * choice is stable across runs - which is what makes batch merges idempotent.
 *
 * `isSelf` outranks all of it: mergeContacts refuses to archive the workspace
 * owner, so proposing it as a secondary would just produce a group that can
 * never be actioned.
 */
export function pickPrimary(members: DuplicateGroupMember[]): string {
  const ranked = [...members].sort((left, right) => {
    if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1;
    if (right.enrichmentScore !== left.enrichmentScore) {
      return right.enrichmentScore - left.enrichmentScore;
    }
    if (right.identityCount !== left.identityCount) {
      return right.identityCount - left.identityCount;
    }
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.contactId < right.contactId ? -1 : 1;
  });
  return ranked[0].contactId;
}

export function findDuplicateContacts(options: FindDuplicatesOptions = {}): DuplicateCandidate[] {
  const tiers = new Set<DuplicateTier>(options.tiers ?? [1, 2, 3]);
  const minConfidence = options.minConfidence ?? 0;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const facts = loadContactFacts(options.contactIds);
  if (facts.size < 2) return [];

  const all = [...facts.values()];
  const evidence = new Map<string, PairEvidence>();

  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      const found =
        (tiers.has(1) ? tier1Evidence(a, b) : null) ??
        (tiers.has(2) ? tier2Evidence(a, b) : null) ??
        (tiers.has(3) ? tier3Evidence(a, b) : null);
      if (!found || found.confidence < minConfidence) continue;
      evidence.set(pairKey(a.id, b.id), found);
    }
  }
  if (evidence.size === 0) return [];

  // Union-find so a 3-way duplicate collapses into one merge, not two.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor) ?? cursor;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };

  for (const pair of evidence.values()) union(pair.a, pair.b);

  const groups = new Map<string, Set<string>>();
  for (const pair of evidence.values()) {
    const root = find(pair.a);
    const group = groups.get(root) ?? new Set<string>();
    group.add(pair.a);
    group.add(pair.b);
    groups.set(root, group);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const [root, ids] of groups) {
    const members: DuplicateGroupMember[] = [...ids]
      .map((id) => facts.get(id))
      .filter((fact): fact is ContactFacts => Boolean(fact))
      .map((fact) => ({
        contactId: fact.id,
        name: fact.name,
        enrichmentScore: fact.enrichmentScore,
        identityCount: fact.identityCount,
        createdAt: fact.createdAt,
        isSelf: fact.isSelf,
      }));
    if (members.length < 2) continue;

    // A group is only as strong as its weakest link, so report the lowest
    // confidence and the tier that produced it.
    const groupEvidence = [...evidence.values()].filter((pair) => find(pair.a) === root);
    const weakest = groupEvidence.reduce((low, pair) =>
      pair.confidence < low.confidence ? pair : low,
    );

    const primaryContactId = pickPrimary(members);
    const secondaryContactIds: string[] = [];
    for (const member of members) {
      if (member.contactId !== primaryContactId) secondaryContactIds.push(member.contactId);
    }
    secondaryContactIds.sort();

    candidates.push({
      primaryContactId,
      secondaryContactIds,
      tier: weakest.tier,
      confidence: weakest.confidence,
      reason: weakest.reason,
      members,
    });
  }

  return candidates
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return left.primaryContactId < right.primaryContactId ? -1 : 1;
    })
    .slice(0, limit);
}
