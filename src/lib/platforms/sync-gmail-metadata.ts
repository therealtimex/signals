import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities } from "@/lib/db/schema";
import { updateContact } from "@/lib/db/queries/contacts";
import { logInteraction } from "@/lib/db/queries/interactions";
import { updatePlatformAccount } from "@/lib/db/queries/platform-accounts";
import { getSyncCursor, updateSyncCursor } from "@/lib/db/queries/sync";
import {
  getGmailMessagesByContact,
  getGmailMessageMetadata,
} from "@/lib/platforms/gmail/client";
import type { SyncResult } from "@/lib/platforms/adapter";

/**
 * Sync Gmail metadata for contacts that have email addresses.
 * Queries Gmail for per-contact message frequency and last interaction date.
 * Stores in contacts.metadata JSON (merged, not replaced).
 */
export async function syncGmailMetadata(
  accountId: string,
  opts?: { maxContacts?: number }
): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const maxContacts = opts?.maxContacts ?? 50; // Rate limit safety

  // Get or create sync cursor for tracking
  const cursor = getSyncCursor(accountId, "gmail_metadata");
  updateSyncCursor(cursor.id, {
    syncStatus: "syncing",
    lastSyncStartedAt: Math.floor(Date.now() / 1000),
  });

  try {
    // Find contacts with email addresses
    const contactsWithEmail = db
      .select()
      .from(contacts)
      .where(isNotNull(contacts.email))
      .limit(maxContacts)
      .all();

    if (contactsWithEmail.length === 0) {
      updateSyncCursor(cursor.id, {
        syncStatus: "completed",
        lastSyncCompletedAt: Math.floor(Date.now() / 1000),
      });
      return result;
    }

    // Calculate 30-day window for frequency counting
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = new Date(now * 1000);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const afterDate = `${thirtyDaysAgo.getFullYear()}/${String(thirtyDaysAgo.getMonth() + 1).padStart(2, "0")}/${String(thirtyDaysAgo.getDate()).padStart(2, "0")}`;

    let processed = 0;

    for (const contact of contactsWithEmail) {
      if (!contact.email) continue;

      try {
        // Get most recent messages for last interaction date
        const recentMessages = await getGmailMessagesByContact(
          accountId,
          contact.email,
          { maxResults: 1 }
        );

        let lastMessageAt: number | null = null;

        if (recentMessages.messages && recentMessages.messages.length > 0) {
          // Get metadata of the most recent message
          const latestMsg = await getGmailMessageMetadata(
            accountId,
            recentMessages.messages[0].id
          );
          if (latestMsg.internalDate) {
            lastMessageAt = Math.floor(parseInt(latestMsg.internalDate) / 1000);
          }
        }

        // Get sent messages in the last 30 days
        const sentMessages = await getGmailMessagesByContact(
          accountId,
          contact.email,
          {
            maxResults: 100,
            query: `to:${contact.email} after:${afterDate}`,
          }
        );
        const sent30d = sentMessages.messages?.length ?? 0;

        // Get received messages in the last 30 days
        const receivedMessages = await getGmailMessagesByContact(
          accountId,
          contact.email,
          {
            maxResults: 100,
            query: `from:${contact.email} after:${afterDate}`,
          }
        );
        const received30d = receivedMessages.messages?.length ?? 0;

        // Merge metadata (preserve existing, add messageFrequency)
        const existingMetadata = contact.metadata ? JSON.parse(contact.metadata) : {};
        const updatedMetadata = {
          ...existingMetadata,
          messageFrequency: {
            sent30d,
            received30d,
            lastMessageAt,
          },
        };

        // Update contact
        const updates: Record<string, unknown> = {
          metadata: JSON.stringify(updatedMetadata),
        };

        updateContact(contact.id, updates);

        if (lastMessageAt && (!contact.lastInteractionAt || lastMessageAt > contact.lastInteractionAt)) {
          logInteraction({
            contactId: contact.id,
            interactionType: "email",
            occurredAt: lastMessageAt,
            source: "sync:gmail",
            metadata: { sent30d, received30d },
          });
        }

        result.updated++;
        processed++;
      } catch (err) {
        result.errors.push(
          `Failed to sync metadata for ${contact.name} (${contact.email}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Update sync timestamps
    updateSyncCursor(cursor.id, {
      syncStatus: "completed",
      totalItemsSynced: (cursor.totalItemsSynced ?? 0) + processed,
      lastSyncCompletedAt: now,
    });

    updatePlatformAccount(accountId, {
      lastSyncedAt: now,
    });
  } catch (err) {
    result.errors.push(
      `Metadata sync failed: ${err instanceof Error ? err.message : String(err)}`
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
