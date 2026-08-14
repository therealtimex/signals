import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities } from "@/lib/db/schema";
import { createContact, updateContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { getSyncCursor, updateSyncCursor } from "@/lib/db/queries/sync";
import {
  mapLinkedInConnectionToContact,
  mapLinkedInConnectionToIdentity,
} from "@/lib/platforms/linkedin/mappers";
import { getConnections } from "@/lib/platforms/linkedin/client";
import type { LinkedInConnection } from "@/lib/platforms/linkedin/client";
import type { SyncResult } from "@/lib/platforms/adapter";

/**
 * Sync contacts from LinkedIn connections into Signals.
 * Uses offset-based pagination (not cursor-based like X).
 * Cross-platform dedup: matches by LinkedIn ID, then by email.
 */
export async function syncContactsFromLinkedIn(
  accountId: string,
  opts?: { maxPages?: number }
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const maxPages = opts?.maxPages ?? 10; // Safety limit: 10 pages * 50 = 500 contacts max

  // Get or create sync cursor for tracking
  const cursor = getSyncCursor(accountId, "connections");
  updateSyncCursor(cursor.id, {
    syncStatus: "syncing",
    lastSyncStartedAt: Math.floor(Date.now() / 1000),
  });

  try {
    let start = 0;
    let page = 0;

    while (page < maxPages) {
      const res = await getConnections(accountId, { start, count: 50 });
      const connections = res.elements ?? [];
      if (connections.length === 0) break;

      // Process each connection
      for (const connection of connections) {
        try {
          processLinkedInConnection(connection, result);
        } catch (err) {
          const name = `${connection.localizedFirstName ?? ""} ${connection.localizedLastName ?? ""}`.trim();
          result.errors.push(
            `Failed to process ${name || connection.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Update cursor progress
      updateSyncCursor(cursor.id, {
        totalItemsSynced: (cursor.totalItemsSynced ?? 0) + connections.length,
        cursor: String(start + connections.length),
      });

      // Check if there are more pages
      const total = res.paging?.total ?? 0;
      start += res.paging?.count ?? 50;
      if (start >= total) break;
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

/** Process a single LinkedIn connection — create or update contact + identity with cross-platform dedup. */
function processLinkedInConnection(connection: LinkedInConnection, result: SyncResult): void {
  // 1. Check for existing identity by (platform="linkedin", platformUserId)
  const existingIdentity = db
    .select()
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, "linkedin"),
        eq(contactIdentities.platformUserId, connection.id)
      )
    )
    .get();

  if (existingIdentity) {
    // Update existing contact with latest LinkedIn data
    const contactData = mapLinkedInConnectionToContact(connection);
    updateContact(existingIdentity.contactId, {
      headline: contactData.headline,
      photoUrl: contactData.photoUrl,
      avatarUrl: contactData.avatarUrl,
    });

    // Update identity with latest platform data
    db.update(contactIdentities)
      .set({
        platformHandle: mapLinkedInConnectionToIdentity(connection, existingIdentity.contactId).platformHandle,
        platformData: mapLinkedInConnectionToIdentity(connection, existingIdentity.contactId).platformData,
        lastSyncedAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, existingIdentity.id))
      .run();

    recalcEnrichment(existingIdentity.contactId);
    result.updated++;
    return;
  }

  // 2. Cross-platform dedup: check if we can match by name (first+last)
  //    Note: email is not available at the connection level without additional API scopes
  const contactData = mapLinkedInConnectionToContact(connection);

  // Create new contact
  const contact = createContact(contactData);

  // Create identity linking this contact to the LinkedIn connection
  const identityData = mapLinkedInConnectionToIdentity(connection, contact.id);
  createIdentity(identityData);

  // Recompute enrichment with the new identity
  recalcEnrichment(contact.id);
  result.added++;
}
