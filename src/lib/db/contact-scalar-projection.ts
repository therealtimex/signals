import { eq, desc } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { resolvePrimaryChannel } from "@/lib/db/queries/contact-channels";
import { contacts, contactIdentities } from "@/lib/db/schema";
import type { NewContact } from "@/lib/db/types";

function contactsHasColumn(name: string): boolean {
  const rows = sqlite.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  return rows.some((row) => row.name === name);
}

function resolvePrimaryIdentity(contactId: string) {
  const rows = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .orderBy(desc(contactIdentities.isPrimary), desc(contactIdentities.createdAt))
    .all();
  return rows.find((row) => row.isPrimary) ?? rows[0];
}

/** Write-through projection of retiring scalar columns from channels/identities. */
export function syncContactScalarProjections(contactId: string): void {
  const updates: Partial<NewContact> & { updatedAt: number } = {
    updatedAt: Math.floor(Date.now() / 1000),
  };

  if (contactsHasColumn("email")) {
    const emailChannel = resolvePrimaryChannel(contactId, "email");
    updates.email = emailChannel?.value?.trim() || null;
  }

  if (contactsHasColumn("phone")) {
    const phoneChannel = resolvePrimaryChannel(contactId, "phone");
    updates.phone = phoneChannel?.value?.trim() || null;
  }

  if (contactsHasColumn("verified_email")) {
    const emailChannel = resolvePrimaryChannel(contactId, "email");
    updates.verifiedEmail = emailChannel?.isVerified ? 1 : 0;
  }

  if (contactsHasColumn("platform") || contactsHasColumn("platform_user_id")) {
    const primary = resolvePrimaryIdentity(contactId);
    if (contactsHasColumn("platform")) {
      updates.platform = primary?.platform ?? null;
    }
    if (contactsHasColumn("platform_user_id")) {
      updates.platformUserId = primary?.platformUserId ?? null;
    }
  }

  db.update(contacts)
    .set(updates as Partial<NewContact>)
    .where(eq(contacts.id, contactId))
    .run();
}

/** Rebuild scalar projections for every contact (recovery after column restore). */
export function reconstructAllContactScalarProjections(): number {
  const ids = db.select({ id: contacts.id }).from(contacts).all();
  for (const { id } of ids) {
    syncContactScalarProjections(id);
  }
  return ids.length;
}
