import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import type { Platform } from "@/lib/db/platforms";

/** Look up a contact by platform identity (dedup key). */
export function getContactIdByPlatformIdentity(
  platform: string,
  platformUserId: string,
): string | undefined {
  const row = db
    .select({ contactId: contactIdentities.contactId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, platform as Platform),
        eq(contactIdentities.platformUserId, platformUserId),
      ),
    )
    .get();
  return row?.contactId;
}

/**
 * Ensure a CRM contact exists for the authenticated platform actor (e.g. the
 * connected X account owner). Used when recording outbound manual engagements.
 */
export function ensurePlatformActorContact(input: {
  platform: Platform;
  platformUserId: string;
  displayName: string;
  platformHandle?: string | null;
}): string {
  const existing = getContactIdByPlatformIdentity(input.platform, input.platformUserId);
  if (existing) return existing;

  const contact = createContact({
    name: input.displayName,
    metadata: JSON.stringify({ platformActor: true }),
  });

  createIdentity({
    contactId: contact.id,
    platform: input.platform,
    platformUserId: input.platformUserId,
    platformHandle: input.platformHandle ?? null,
    displayName: input.displayName,
    isPrimary: 1,
    isActive: 1,
  });

  return contact.id;
}
