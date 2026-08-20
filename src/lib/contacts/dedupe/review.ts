import { getContactsByIds } from "@/lib/db/queries/contacts";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import {
  findDuplicateContacts,
  type DuplicateCandidate,
  type DuplicateGroupMember,
  type DuplicateTier,
  type FindDuplicatesOptions,
} from "./detect";

/**
 * Display shape for the in-app dedupe review panel.
 *
 * `findDuplicateContacts` returns the decision fields an agent needs and nothing more. A human
 * reviewing the same group needs enough of each record on screen to tell the two apart, so the
 * members are hydrated here rather than by widening the agent-tool contract.
 */
export interface DedupeReviewMember extends DuplicateGroupMember {
  email: string | null;
  company: string | null;
  title: string | null;
  /** `platform:handle` pairs, e.g. `x:sama`. */
  handles: string[];
  isPrimary: boolean;
}

export interface DedupeReviewGroup {
  primaryContactId: string;
  secondaryContactIds: string[];
  tier: DuplicateTier;
  confidence: number;
  reason: string;
  members: DedupeReviewMember[];
}

function formatHandles(contact: ContactDTO | undefined): string[] {
  if (!contact) return [];
  const seen = new Set<string>();
  for (const identity of contact.identities) {
    const handle = identity.platformHandle?.trim() || identity.platformUserId.trim();
    if (!handle) continue;
    seen.add(`${identity.platform}:${handle.replace(/^@/, "")}`);
  }
  return [...seen];
}

/**
 * Members render primary-first, then richest record first — the same order the reviewer reads
 * them in, so "keep this one" is always the top row.
 */
function sortMembers(
  members: DedupeReviewMember[],
  primaryContactId: string
): DedupeReviewMember[] {
  return [...members].sort((a, b) => {
    if (a.contactId === primaryContactId) return -1;
    if (b.contactId === primaryContactId) return 1;
    if (a.enrichmentScore !== b.enrichmentScore) return b.enrichmentScore - a.enrichmentScore;
    if (a.identityCount !== b.identityCount) return b.identityCount - a.identityCount;
    return a.name.localeCompare(b.name);
  });
}

function hydrateGroup(
  candidate: DuplicateCandidate,
  byId: Map<string, ContactDTO>
): DedupeReviewGroup {
  const members = candidate.members.map<DedupeReviewMember>((member) => {
    // A contact deleted between detection and hydration still renders from the detect facts.
    const contact = byId.get(member.contactId);
    return {
      ...member,
      email: contact?.email ?? null,
      company: contact?.company ?? null,
      title: contact?.title ?? null,
      handles: formatHandles(contact),
      isPrimary: member.contactId === candidate.primaryContactId,
    };
  });

  return {
    primaryContactId: candidate.primaryContactId,
    secondaryContactIds: candidate.secondaryContactIds,
    tier: candidate.tier,
    confidence: candidate.confidence,
    reason: candidate.reason,
    members: sortMembers(members, candidate.primaryContactId),
  };
}

/** Detect duplicates and hydrate each member for review. Read-only. */
export function buildDedupeReview(options: FindDuplicatesOptions = {}): DedupeReviewGroup[] {
  const candidates = findDuplicateContacts(options);
  if (candidates.length === 0) return [];

  const ids = [...new Set(candidates.flatMap((c) => c.members.map((m) => m.contactId)))];
  const byId = new Map(getContactsByIds(ids).map((contact) => [contact.id, contact]));

  return candidates.map((candidate) => hydrateGroup(candidate, byId));
}
