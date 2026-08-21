import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { assertPlatformAccountUnclaimed, PlatformAccountConflictError } from "@/lib/db/identity-claims";
import { contactIdentities } from "@/lib/db/schema";
import { liftIdentityStatsFromPlatformData } from "@/lib/db/identity-stats";
import { normalizePlatformHandle } from "@/lib/contact-identity-handle";
import type { ContactIdentity, NewContactIdentity } from "@/lib/db/types";

/**
 * `platform_handle` stores the bare identifier; the `@` on an X handle is presentation and is
 * added by `formatPlatformHandle` at render time. Every writer — the identities API route, both
 * agent-tools upserts, the Go importer, and the two manual forms — goes through create/update,
 * so normalizing here is what keeps migration 0029 from silently undoing itself.
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

export function deleteIdentityForContact(contactId: string, identityId: string): boolean {
  const existing = db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.id, identityId), eq(contactIdentities.contactId, contactId)))
    .get();

  if (!existing) return false;

  db.delete(contactIdentities).where(eq(contactIdentities.id, identityId)).run();
  return true;
}
