import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { createContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { mapXUserToContact, mapXUserToIdentity, xUserIdentitySyncPatch } from "@/lib/platforms/x/mappers";
import { getFollowing, getAuthenticatedUser } from "@/lib/platforms/x/client";
import type { XUser } from "@/lib/platforms/x/client";
import type { SyncResult } from "@/lib/platforms/adapter";

/**
 * Sync contacts from a platform account's following list into Signals.
 * Deduplicates by (platform, platformUserId) via the contactIdentities table.
 */
export async function syncContactsFromPlatform(
  accountId: string,
  opts?: { maxPages?: number }
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const maxPages = opts?.maxPages ?? 10; // Safety limit: 10 pages * 100 = 1000 contacts max

  try {
    // Get the authenticated user's ID
    const me = await getAuthenticatedUser(accountId);

    let cursor: string | undefined;
    let page = 0;

    while (page < maxPages) {
      const res = await getFollowing(accountId, me.id, {
        maxResults: 100,
        paginationToken: cursor,
      });

      const users = Array.isArray(res.data) ? res.data : [];
      if (users.length === 0) break;

      // Process each user in the page
      for (const xUser of users) {
        try {
          processXUser(xUser, result);
        } catch (err) {
          result.errors.push(
            `Failed to process @${xUser.username}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Move to next page
      cursor = res.meta?.next_token || undefined;
      if (!cursor) break;
      page++;
    }

    // Update last synced timestamp
    updatePlatformAccount(accountId, {
      lastSyncedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    result.errors.push(
      `Sync failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

/** Process a single X user — create or update contact + identity. */
function processXUser(xUser: XUser, result: SyncResult): void {
  // Check for existing identity by (platform, platformUserId)
  const existingIdentity = db
    .select()
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, "x"),
        eq(contactIdentities.platformUserId, xUser.id)
      )
    )
    .get();

  if (existingIdentity) {
    // Update identity with latest platform data + explore-card stat columns
    db.update(contactIdentities)
      .set({
        ...xUserIdentitySyncPatch(xUser, existingIdentity.contactId),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(contactIdentities.id, existingIdentity.id))
      .run();

    recalcEnrichment(existingIdentity.contactId);
    result.updated++;
    return;
  }

  // Create new contact
  const contactData = mapXUserToContact(xUser);
  const contact = createContact(contactData);

  // Create identity linking this contact to the X user
  const identityData = mapXUserToIdentity(xUser, contact.id);
  createIdentity(identityData);

  // Recompute enrichment with the new identity
  recalcEnrichment(contact.id);
  result.added++;
}
