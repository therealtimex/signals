import { eq, desc } from "drizzle-orm";
import { db, sqlite } from "@/lib/db/client";
import { resolvePrimaryChannel } from "@/lib/db/queries/contact-channels";
import { resolveCurrentEmployment } from "@/lib/db/queries/contact-employments";
import { contacts, contactIdentities } from "@/lib/db/schema";
import type { NewContact } from "@/lib/db/types";

export type ScalarProjectionDomain = "channels" | "identities" | "employments";

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

/** Project retiring email/phone scalars from primary channels only. */
export function syncChannelScalarProjections(contactId: string): void {
  const updates: Partial<NewContact> = {};

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

  if (Object.keys(updates).length === 0) return;

  db.update(contacts)
    .set(updates as Partial<NewContact>)
    .where(eq(contacts.id, contactId))
    .run();
}

/** Project retiring platform scalars from primary identity only. */
export function syncIdentityScalarProjections(contactId: string): void {
  const updates: Partial<NewContact> = {};

  if (contactsHasColumn("platform") || contactsHasColumn("platform_user_id")) {
    const primary = resolvePrimaryIdentity(contactId);
    if (contactsHasColumn("platform")) {
      updates.platform = primary?.platform ?? null;
    }
    if (contactsHasColumn("platform_user_id")) {
      updates.platformUserId = primary?.platformUserId ?? null;
    }
  }

  if (Object.keys(updates).length === 0) return;

  db.update(contacts)
    .set(updates as Partial<NewContact>)
    .where(eq(contacts.id, contactId))
    .run();
}

/** Project retiring company/title scalars from the resolved current employment. */
export function syncEmploymentScalarProjections(contactId: string): void {
  const updates: Partial<NewContact> = {};
  const current = resolveCurrentEmployment(contactId);

  if (contactsHasColumn("company")) {
    updates.company = current?.orgName?.trim() || null;
  }

  if (contactsHasColumn("title")) {
    updates.title = current?.title ?? null;
  }

  if (Object.keys(updates).length === 0) return;

  db.update(contacts)
    .set(updates as Partial<NewContact>)
    .where(eq(contacts.id, contactId))
    .run();
}

/** Write-through projection of all retiring scalar columns. */
export function syncContactScalarProjections(
  contactId: string,
  domains: ScalarProjectionDomain[] = ["channels", "identities", "employments"],
): void {
  if (domains.includes("channels")) {
    syncChannelScalarProjections(contactId);
  }
  if (domains.includes("identities")) {
    syncIdentityScalarProjections(contactId);
  }
  if (domains.includes("employments")) {
    syncEmploymentScalarProjections(contactId);
  }
}

/** Rebuild scalar projections for every contact (recovery after column restore). */
export function reconstructAllContactScalarProjections(): number {
  const ids = db.select({ id: contacts.id }).from(contacts).all();
  for (const { id } of ids) {
    syncContactScalarProjections(id);
  }
  return ids.length;
}
