import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities } from "@/lib/db/schema";
import { createContact, updateContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { findContactByChannel } from "@/lib/db/queries/contact-channels";
import { createIdentity } from "@/lib/db/queries/identities";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { getSyncCursor, updateSyncCursor } from "@/lib/db/queries/sync";
import {
  mapGooglePersonToContact,
  mapGooglePersonToIdentity,
} from "@/lib/platforms/gmail/mappers";
import { getGoogleContacts } from "@/lib/platforms/gmail/client";
import type { GooglePerson } from "@/lib/platforms/gmail/client";
import type { SyncResult } from "@/lib/platforms/adapter";

/**
 * Sync contacts from Google People API into Signals.
 * Uses token-based pagination (pageToken, not offset-based like LinkedIn).
 * 2-tier dedup: gmail identity match → email match → create new.
 *
 * Gmail address-book contacts are not projected into the Explore audience graph
 * (no follow/connection semantics). See `src/lib/graph/relationship-edges.ts`.
 */
export async function syncContactsFromGmail(
  accountId: string,
  opts?: { maxPages?: number }
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const maxPages = opts?.maxPages ?? 10; // Safety limit: 10 pages * 100 = 1000 contacts max

  // Get or create sync cursor for tracking
  const cursor = getSyncCursor(accountId, "google_contacts");
  updateSyncCursor(cursor.id, {
    syncStatus: "syncing",
    lastSyncStartedAt: Math.floor(Date.now() / 1000),
  });

  try {
    let pageToken: string | undefined = undefined;
    let page = 0;

    while (page < maxPages) {
      const res = await getGoogleContacts(accountId, { pageToken, pageSize: 100 });
      const people = res.connections ?? [];
      if (people.length === 0) break;

      // Process each person
      for (const person of people) {
        try {
          processGooglePerson(person, result);
        } catch (err) {
          const name = person.names?.[0]?.displayName ?? person.resourceName;
          result.errors.push(
            `Failed to process ${name}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Update cursor progress
      updateSyncCursor(cursor.id, {
        totalItemsSynced: (cursor.totalItemsSynced ?? 0) + people.length,
        cursor: res.nextPageToken ?? null,
      });

      // Check if there are more pages
      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
      page++;
    }

    // Update sync timestamps — always set lastSyncCompletedAt (partial sync pattern)
    const now = Math.floor(Date.now() / 1000);
    updateSyncCursor(cursor.id, {
      syncStatus: "completed",
      lastSyncCompletedAt: now,
    });

    updatePlatformAccount(accountId, {
      lastSyncedAt: now,
    });
  } catch (err) {
    result.errors.push(
      `Sync failed: ${err instanceof Error ? err.message : String(err)}`
    );

    // Always set lastSyncCompletedAt even on error (partial sync pattern)
    updateSyncCursor(cursor.id, {
      syncStatus: "failed",
      lastSyncCompletedAt: Math.floor(Date.now() / 1000),
      lastError: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

/** Process a single Google person — create or update contact + identity with cross-platform dedup. */
function processGooglePerson(person: GooglePerson, result: SyncResult): void {
  const resourceId = person.resourceName.replace(/^people\//, "");

  // 1. Check for existing identity by (platform="gmail", platformUserId)
  const existingIdentity = db
    .select()
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, "gmail"),
        eq(contactIdentities.platformUserId, resourceId)
      )
    )
    .get();

  if (existingIdentity) {
    // Update existing contact with latest Google data
    const contactData = mapGooglePersonToContact(person);
    updateContact(existingIdentity.contactId, {
      firstName: contactData.firstName,
      lastName: contactData.lastName,
      email: contactData.email,
      phone: contactData.phone,
      company: contactData.company,
      title: contactData.title,
    });

    // Update identity with latest platform data
    const identityData = mapGooglePersonToIdentity(person, existingIdentity.contactId);
    db.update(contactIdentities)
      .set({
        platformHandle: identityData.platformHandle,
        platformData: identityData.platformData,
        bio: identityData.bio,
        avatarUrl: identityData.avatarUrl,
        location: identityData.location,
        websiteUrl: identityData.websiteUrl,
        lastSyncedAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, existingIdentity.id))
      .run();

    recalcEnrichment(existingIdentity.contactId);
    result.updated++;
    return;
  }

  // 2. Cross-platform dedup: match any person email via contact_channels
  const contactData = mapGooglePersonToContact(person);
  const personEmails = (person.emailAddresses ?? [])
    .map((e) => e.value)
    .filter((v): v is string => !!v);

  for (const email of personEmails) {
    const emailMatch = findContactByChannel("email", email);

    if (emailMatch) {
      updateContact(emailMatch.id, {
        firstName: contactData.firstName ?? emailMatch.firstName,
        lastName: contactData.lastName ?? emailMatch.lastName,
        phone: contactData.phone ?? emailMatch.phone,
        company: contactData.company ?? emailMatch.company,
        title: contactData.title ?? emailMatch.title,
        email: contactData.email,
      }, "sync:gmail_contacts");

      const identityData = mapGooglePersonToIdentity(person, emailMatch.id);
      createIdentity(identityData);
      recalcEnrichment(emailMatch.id);
      result.updated++;
      return;
    }
  }

  // 3. Create new contact
  const contact = createContact(contactData, "sync:gmail_contacts");
  const identityData = mapGooglePersonToIdentity(person, contact.id);
  createIdentity(identityData);
  recalcEnrichment(contact.id);
  result.added++;
}
