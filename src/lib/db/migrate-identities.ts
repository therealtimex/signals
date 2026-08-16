import { eq, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, sqlite } from "./client";
import { contacts, contactIdentities, contactChannels } from "./schema";
import { calculateEnrichmentScore } from "./enrichment";
import type { ContactIdentity } from "./types";

type LegacyContactPlatformRow = {
  id: string;
  platform: string;
  platformUserId: string;
  profileUrl: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
};

function contactsHasLegacyPlatformColumn(): boolean {
  const rows = sqlite.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  return rows.some((row) => row.name === "platform");
}

/**
 * One-time migration: creates contactIdentities rows from legacy
 * platform columns on contacts, parses names, and computes enrichment scores.
 *
 * Safe to call repeatedly — only runs when contacts have platform data
 * but zero identity rows exist.
 */
export function migrateContactIdentities(): { migrated: number } {
  if (!contactsHasLegacyPlatformColumn()) {
    return { migrated: 0 };
  }

  const contactsWithPlatform = sqlite
    .prepare(
      `SELECT
        id,
        platform,
        platform_user_id AS platformUserId,
        profile_url AS profileUrl,
        name,
        first_name AS firstName,
        last_name AS lastName
      FROM contacts
      WHERE platform IS NOT NULL AND platform_user_id IS NOT NULL`,
    )
    .all() as LegacyContactPlatformRow[];

  if (contactsWithPlatform.length === 0) {
    return { migrated: 0 };
  }

  const identityCount = db
    .select({ value: count() })
    .from(contactIdentities)
    .get()?.value ?? 0;

  if (identityCount > 0) {
    return { migrated: 0 };
  }

  let migrated = 0;

  db.transaction((tx) => {
    for (const contact of contactsWithPlatform) {
      tx.insert(contactIdentities)
        .values({
          id: nanoid(),
          contactId: contact.id,
          platform: contact.platform as ContactIdentity["platform"],
          platformUserId: contact.platformUserId,
          platformUrl: contact.profileUrl,
          isPrimary: 1,
          isActive: 1,
        })
        .run();
      migrated++;
    }

    const allContacts = tx.select().from(contacts).all();
    for (const contact of allContacts) {
      const updates: Record<string, unknown> = {};

      if (!contact.firstName && !contact.lastName && contact.name) {
        const idx = contact.name.indexOf(" ");
        if (idx === -1) {
          updates.firstName = contact.name;
          updates.lastName = "";
        } else {
          updates.firstName = contact.name.slice(0, idx);
          updates.lastName = contact.name.slice(idx + 1);
        }
      }

      const identities = tx
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, contact.id))
        .all();

      const channels = tx
        .select()
        .from(contactChannels)
        .where(eq(contactChannels.contactId, contact.id))
        .all();

      const enrichedContact = { ...contact, ...updates } as typeof contact;
      updates.enrichmentScore = calculateEnrichmentScore(
        enrichedContact,
        identities,
        channels,
      );

      if (Object.keys(updates).length > 0) {
        tx.update(contacts)
          .set(updates)
          .where(eq(contacts.id, contact.id))
          .run();
      }
    }
  });

  return { migrated };
}
