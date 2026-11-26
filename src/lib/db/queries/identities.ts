import { eq, and, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { assertPlatformAccountUnclaimed, PlatformAccountConflictError } from "@/lib/db/identity-claims";
import { contactIdentities } from "@/lib/db/schema";
import { liftIdentityStatsFromPlatformData } from "@/lib/db/identity-stats";
import { normalizePlatformHandle } from "@/lib/contact-identity-handle";
import type { ContactIdentity, NewContactIdentity } from "@/lib/db/types";

/**
 * `platform_handle` stores the bare identifier; the `@` on an X handle is presentation and is
 * added by `formatPlatformHandle` at render time. Normalizing here is what keeps migration 0029
 * from silently undoing itself.
 *
 * Covered by this choke point: the identities API route, both agent-tools upserts, the Go
 * importer (which POSTs to `/api/agent-tools/invoke`), and the two manual forms.
 *
 * **Not covered:** `sync-gmail-contacts.ts` and `sync-linkedin-contacts.ts` set
 * `platform_handle` with raw drizzle. That is safe only because both are non-X and
 * `normalizePlatformHandle` is trim-only off X. **A new X writer must go through
 * create/update, not copy those two** — a raw-drizzle X write would reintroduce exactly the
 * drift this exists to stop.
 */
function normalizeHandleForWrite(
  platform: string,
  handle: string | null | undefined,
): string | null | undefined {
  if (handle === undefined || handle === null) return handle;
  return normalizePlatformHandle(platform, handle) || null;
}

function guardContactIdentityClaim(
  platform: string,
  platformUserId: string,
): void {
  assertPlatformAccountUnclaimed(platform, platformUserId, { claimant: "contact" });
}

export function listIdentitiesByContact(contactId: string): ContactIdentity[] {
  return db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all();
}

export function getIdentityById(id: string): ContactIdentity | undefined {
  return db.select().from(contactIdentities).where(eq(contactIdentities.id, id)).get();
}

export function createIdentity(data: Omit<NewContactIdentity, "id">): ContactIdentity {
  guardContactIdentityClaim(data.platform, data.platformUserId);
  const id = nanoid();
  const lifted = liftIdentityStatsFromPlatformData(data.platformData, {
    statsUpdatedAt: data.lastSyncedAt ?? undefined,
  });
  db.insert(contactIdentities)
    .values({
      ...data,
      platformHandle: normalizeHandleForWrite(data.platform, data.platformHandle),
      ...lifted,
      id,
    })
    .run();
  return getIdentityById(id)!;
}

export function updateIdentity(
  id: string,
  data: Partial<Omit<NewContactIdentity, "id">>
): ContactIdentity | undefined {
  const existing = getIdentityById(id);
  if (!existing) return undefined;

  const nextPlatform = data.platform ?? existing.platform;
  const nextPlatformUserId = data.platformUserId ?? existing.platformUserId;
  guardContactIdentityClaim(nextPlatform, nextPlatformUserId);

  const lifted =
    data.platformData !== undefined
      ? liftIdentityStatsFromPlatformData(data.platformData, {
          statsUpdatedAt: data.lastSyncedAt ?? existing.lastSyncedAt ?? undefined,
        })
      : {};

  db.update(contactIdentities)
    .set({
      ...data,
      ...(data.platformHandle === undefined
        ? {}
        : { platformHandle: normalizeHandleForWrite(nextPlatform, data.platformHandle) }),
      ...lifted,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(contactIdentities.id, id))
    .run();

  return getIdentityById(id);
}

export type RemovedContactIdentity = {
  removed: ContactIdentity;
  /** The identity made primary because the removed one was; null otherwise. */
  promoted: ContactIdentity | null;
  /**
   * An active identity that was already primary alongside the removed one (legacy contacts can
   * hold two, since `upsert_contact_identity {isPrimary: true}` never cleared the others). When
   * set, nothing is promoted.
   */
  remainingPrimary: ContactIdentity | null;
};

/**
 * Delete one of a contact's identities (#569). Deleting the row is what releases its
 * `(platform, platformUserId)` claim, which `idx_identity_platform_user` holds, and what takes it
 * out of every lookup (claims, `query_contacts`, import dedupe, `get_contact`, research).
 * Identity metrics cascade, and channels and unverified-candidate links are set null.
 *
 * When the removed identity was primary, the contact's earliest-created remaining **active**
 * identity becomes primary, so readers that trust `isPrimary` (research's primary-identity
 * resolution, the profile resolver) keep agreeing. With no active identity left, none is primary.
 * If another active identity is still primary (a legacy contact with two), nothing is promoted:
 * promoting would leave the contact with two primaries again.
 *
 * Returns null when the identity doesn't exist or belongs to another contact.
 */
export function removeIdentityForContact(
  contactId: string,
  identityId: string,
): RemovedContactIdentity | null {
  return db.transaction(() => {
    const existing = db
      .select()
      .from(contactIdentities)
      .where(and(eq(contactIdentities.id, identityId), eq(contactIdentities.contactId, contactId)))
      .get();
    if (!existing) return null;

    db.delete(contactIdentities).where(eq(contactIdentities.id, identityId)).run();

    let promoted: ContactIdentity | null = null;
    let remainingPrimary: ContactIdentity | null = null;
    if (existing.isPrimary) {
      remainingPrimary =
        db
          .select()
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.contactId, contactId),
              eq(contactIdentities.isActive, 1),
              eq(contactIdentities.isPrimary, 1),
            ),
          )
          .orderBy(asc(contactIdentities.createdAt), asc(contactIdentities.id))
          .limit(1)
          .get() ?? null;
    }
    if (existing.isPrimary && !remainingPrimary) {
      const next = db
        .select()
        .from(contactIdentities)
        .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.isActive, 1)))
        .orderBy(asc(contactIdentities.createdAt), asc(contactIdentities.id))
        .limit(1)
        .get();
      if (next) {
        db.update(contactIdentities)
          .set({ isPrimary: 1, updatedAt: Math.floor(Date.now() / 1000) })
          .where(eq(contactIdentities.id, next.id))
          .run();
        promoted = getIdentityById(next.id) ?? null;
      }
    }
    return { removed: existing, promoted, remainingPrimary };
  });
}

export function deleteIdentityForContact(contactId: string, identityId: string): boolean {
  return removeIdentityForContact(contactId, identityId) !== null;
}
