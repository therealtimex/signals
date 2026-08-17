import { eq, inArray, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactChannels, contactEmployments, contactIdentities, contacts, mediaAttachments, orgs } from "@/lib/db/schema";
import { assembleContactDto, type ContactDTO, type ContactEmploymentDTO } from "@/lib/db/queries/contact-dto";
import type { Contact } from "@/lib/db/types";

export function attachContactDtos(rows: Contact[]): ContactDTO[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const allIdentities = db
    .select()
    .from(contactIdentities)
    .where(inArray(contactIdentities.contactId, ids))
    .all();

  const allChannels = db
    .select()
    .from(contactChannels)
    .where(inArray(contactChannels.contactId, ids))
    .all();

  const allEmployments = db
    .select()
    .from(contactEmployments)
    .where(inArray(contactEmployments.contactId, ids))
    .all();

  const avatarAttachments = db
    .select()
    .from(mediaAttachments)
    .where(
      and(
        eq(mediaAttachments.parentType, "contact"),
        inArray(mediaAttachments.parentId, ids),
        eq(mediaAttachments.role, "avatar"),
      ),
    )
    .all();

  const orgIds = [...new Set(allEmployments.map((employment) => employment.orgId))];
  const orgRows =
    orgIds.length > 0
      ? db.select().from(orgs).where(inArray(orgs.id, orgIds)).all()
      : [];
  const orgNameById = new Map(orgRows.map((org) => [org.id, org.name]));

  const identityMap = new Map<string, typeof allIdentities>();
  for (const identity of allIdentities) {
    const list = identityMap.get(identity.contactId) ?? [];
    list.push(identity);
    identityMap.set(identity.contactId, list);
  }

  const channelMap = new Map<string, typeof allChannels>();
  for (const channel of allChannels) {
    const list = channelMap.get(channel.contactId) ?? [];
    list.push(channel);
    channelMap.set(channel.contactId, list);
  }

  const employmentMap = new Map<string, ContactEmploymentDTO[]>();
  for (const employment of allEmployments) {
    const list = employmentMap.get(employment.contactId) ?? [];
    list.push({
      ...employment,
      orgName: orgNameById.get(employment.orgId) ?? "",
    });
    employmentMap.set(employment.contactId, list);
  }

  const avatarAssetByContact = new Map<string, string>();
  for (const attachment of avatarAttachments) {
    avatarAssetByContact.set(attachment.parentId, attachment.mediaAssetId);
  }

  return rows.map((row) =>
    assembleContactDto(
      row,
      identityMap.get(row.id) ?? [],
      channelMap.get(row.id) ?? [],
      employmentMap.get(row.id) ?? [],
      avatarAssetByContact.get(row.id) ?? null,
    ),
  );
}

export function getContactDtoById(id: string): ContactDTO | undefined {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return undefined;
  return attachContactDtos([row])[0];
}
