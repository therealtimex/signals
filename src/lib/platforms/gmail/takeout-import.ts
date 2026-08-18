import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactIdentities } from "@/lib/db/schema";
import { createContact, updateContact, recalcEnrichment } from "@/lib/db/queries/contacts";
import { findContactByChannel } from "@/lib/db/queries/contact-channels";
import { createIdentity } from "@/lib/db/queries/identities";
import { applyLegacyCompanyTitle } from "@/lib/db/queries/contact-employment-writes";
import type { SyncResult } from "@/lib/platforms/adapter";
import type { TakeoutContactRow } from "@/lib/platforms/gmail/takeout-parse";

function mapTakeoutRowToContact(row: TakeoutContactRow) {
  return {
    name: row.displayName,
    firstName: row.firstName || null,
    lastName: row.lastName || null,
    email: row.email,
    phone: row.phone,
    company: row.company,
    title: row.title,
    location: row.location,
    bio: row.notes,
  };
}

function mapTakeoutRowToIdentity(row: TakeoutContactRow, contactId: string) {
  return {
    contactId,
    platform: "gmail" as const,
    platformUserId: row.resourceId,
    platformHandle: row.email ?? row.displayName,
    platformUrl: null,
    platformData: JSON.stringify({
      source: "gmail_takeout",
      email: row.email,
      company: row.company,
      title: row.title,
    }),
    isPrimary: 0,
    isActive: 1,
    lastSyncedAt: Math.floor(Date.now() / 1000),
  };
}

function processTakeoutRow(row: TakeoutContactRow, result: SyncResult): void {
  const existingIdentity = db
    .select()
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.platform, "gmail"),
        eq(contactIdentities.platformUserId, row.resourceId)
      )
    )
    .get();

  const contactData = mapTakeoutRowToContact(row);

  if (existingIdentity) {
    updateContact(existingIdentity.contactId, contactData);
    if (row.company) {
      applyLegacyCompanyTitle(
        existingIdentity.contactId,
        { company: row.company, title: row.title },
        "import:gmail_takeout"
      );
    }
    recalcEnrichment(existingIdentity.contactId);
    result.updated++;
    return;
  }

  if (row.email) {
    const existingContact = findContactByChannel("email", row.email);
    if (existingContact) {
      updateContact(existingContact.id, contactData);
      createIdentity(mapTakeoutRowToIdentity(row, existingContact.id));
      if (row.company) {
        applyLegacyCompanyTitle(
          existingContact.id,
          { company: row.company, title: row.title },
          "import:gmail_takeout"
        );
      }
      recalcEnrichment(existingContact.id);
      result.updated++;
      return;
    }
  }

  const contact = createContact(contactData, "import:gmail_takeout");
  createIdentity(mapTakeoutRowToIdentity(row, contact.id));
  if (row.company) {
    applyLegacyCompanyTitle(
      contact.id,
      { company: row.company, title: row.title },
      "import:gmail_takeout"
    );
  }
  recalcEnrichment(contact.id);
  result.added++;
}

/** Import parsed Takeout rows into Signals contacts with golden-record dedup. */
export function importTakeoutContacts(rows: TakeoutContactRow[]): SyncResult {
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    try {
      if (!row.displayName && !row.email) {
        result.skipped++;
        continue;
      }
      processTakeoutRow(row, result);
    } catch (err) {
      const label = row.displayName || row.email || row.resourceId;
      result.errors.push(
        `Failed to process ${label}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
