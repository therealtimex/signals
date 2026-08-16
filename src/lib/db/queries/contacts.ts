import { eq, like, and, or, desc, asc, count, inArray, exists, sql, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contacts,
  contactChannels,
  contactIdentities,
  contentItems,
  tasks,
  workflowSteps,
} from "@/lib/db/schema";
import { deleteEdgesTouchingContact } from "@/lib/db/graph-integrity";
import { calculateEnrichmentScore } from "@/lib/db/enrichment";
import {
  applyChannelInputs,
  applyLegacyEmailPhone,
  type ChannelInput,
} from "@/lib/db/queries/contact-channel-writes";
import { assembleContactDto, type ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Contact, NewContact, PaginatedResult, ContactIdentity } from "@/lib/db/types";

export type ContactWriteExtras = {
  email?: string | null;
  phone?: string | null;
  verifiedEmail?: boolean | number | null;
  channels?: ChannelInput[];
  /** Stripped on write — use contact_identities */
  platform?: string | null;
  platformUserId?: string | null;
};

/** Contact create/update payload with optional channel shim fields. */
export type ContactWriteInput = Omit<NewContact, "id"> & ContactWriteExtras;
export type ContactUpdateInput = Partial<NewContact> & ContactWriteExtras;

/** Split a full name into firstName/lastName on the first space. */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const idx = fullName.indexOf(" ");
  if (idx === -1) return { firstName: fullName, lastName: "" };
  return { firstName: fullName.slice(0, idx), lastName: fullName.slice(idx + 1) };
}

function stripChannelShim<T extends ContactWriteExtras>(data: T): Omit<T, keyof ContactWriteExtras> {
  const {
    email: _e,
    phone: _p,
    verifiedEmail: _v,
    channels: _c,
    platform: _plat,
    platformUserId: _puid,
    ...rest
  } = data;
  return rest;
}

function attachChannels(rows: Contact[]): ContactDTO[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

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

  return rows.map((row) =>
    assembleContactDto(row, identityMap.get(row.id) ?? [], channelMap.get(row.id) ?? []),
  );
}

function applyChannelWrites(
  contactId: string,
  extras: ContactWriteExtras | undefined,
  source: string,
): void {
  if (!extras) return;
  if (extras.channels?.length) {
    applyChannelInputs(contactId, extras.channels, source);
  }
  applyLegacyEmailPhone(contactId, {
    email: extras.email,
    phone: extras.phone,
    verifiedEmail: extras.verifiedEmail,
  }, source);
}

/** Recalculate and persist enrichment score for a contact. */
function recalcEnrichment(contactId: string): void {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) return;
  const identities = db
    .select()
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, contactId))
    .all();
  const channels = db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId))
    .all();
  const score = calculateEnrichmentScore(contact, identities, channels);
  db.update(contacts)
    .set({ enrichmentScore: score, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(contacts.id, contactId))
    .run();
}

export function listContacts(opts?: {
  search?: string;
  funnelStage?: string;
  platform?: string;
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  sort?: "createdAt" | "enrichmentScore";
  order?: "asc" | "desc";
}): PaginatedResult<ContactDTO> {
  const conditions: SQL[] = [];

  if (!opts?.includeArchived) {
    conditions.push(sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`);
  }
  conditions.push(sql`json_extract(${contacts.metadata}, '$.platformActor') IS NOT 1`);

  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(contacts.name, pattern),
        like(contacts.firstName, pattern),
        like(contacts.lastName, pattern),
        exists(
          db
            .select({ id: contactChannels.id })
            .from(contactChannels)
            .where(
              and(
                eq(contactChannels.contactId, contacts.id),
                eq(contactChannels.channelType, "email"),
                like(contactChannels.value, pattern),
              ),
            ),
        ),
      )!,
    );
  }
  if (opts?.funnelStage) {
    conditions.push(eq(contacts.funnelStage, opts.funnelStage as Contact["funnelStage"]));
  }
  if (opts?.platform) {
    conditions.push(
      exists(
        db
          .select({ id: contactIdentities.id })
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.contactId, contacts.id),
              eq(contactIdentities.platform, opts.platform as ContactIdentity["platform"]),
            ),
          ),
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ value: count() })
      .from(contacts)
      .where(whereClause)
      .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const sortField =
    opts?.sort === "enrichmentScore" ? contacts.enrichmentScore : contacts.createdAt;
  const orderDirection = opts?.order ?? (opts?.sort === "enrichmentScore" ? "asc" : "desc");
  const orderByClause = orderDirection === "asc" ? asc(sortField) : desc(sortField);

  const rows = db
    .select()
    .from(contacts)
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: attachChannels(rows), total };
}

export function getContactById(id: string): ContactDTO | undefined {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return undefined;
  return attachChannels([row])[0];
}

export function getContactsByIds(ids: string[]): ContactDTO[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(contacts).where(inArray(contacts.id, ids)).all();
  return attachChannels(rows);
}

export function createContact(
  data: ContactWriteInput,
  channelSource = "api:create_contact",
): ContactDTO {
  const id = nanoid();
  const rowData = stripChannelShim(data);

  const nameFields =
    !rowData.firstName && !rowData.lastName && rowData.name ? parseName(rowData.name) : {};

  const name =
    rowData.name ||
    [rowData.firstName, rowData.lastName].filter(Boolean).join(" ") ||
    "Unknown";

  const now = Math.floor(Date.now() / 1000);

  if (rowData.isSelf === true) {
    db.transaction((tx) => {
      tx.update(contacts)
        .set({ isSelf: false, updatedAt: now })
        .where(eq(contacts.isSelf, true))
        .run();
      tx.insert(contacts)
        .values({ ...rowData, ...nameFields, name, id, isSelf: true })
        .run();
    });
    applyChannelWrites(id, data, channelSource);
    recalcEnrichment(id);
    return getContactById(id)!;
  }

  db.insert(contacts).values({ ...rowData, ...nameFields, name, id }).run();
  applyChannelWrites(id, data, channelSource);
  recalcEnrichment(id);
  return getContactById(id)!;
}

export function updateContact(
  id: string,
  data: ContactUpdateInput,
  channelSource = "api:update_contact",
): ContactDTO | undefined {
  const existing = getContactById(id);
  if (!existing) return undefined;

  const rowUpdates = stripChannelShim(data);
  const updates = { ...rowUpdates };

  if (data.firstName !== undefined || data.lastName !== undefined) {
    const fn = data.firstName ?? existing.firstName ?? "";
    const ln = data.lastName ?? existing.lastName ?? "";
    updates.name = [fn, ln].filter(Boolean).join(" ") || existing.name;
  }

  const now = Math.floor(Date.now() / 1000);

  if (data.isSelf === true) {
    db.transaction((tx) => {
      tx.update(contacts)
        .set({ isSelf: false, updatedAt: now })
        .where(eq(contacts.isSelf, true))
        .run();
      tx.update(contacts)
        .set({ ...updates, isSelf: true, updatedAt: now })
        .where(eq(contacts.id, id))
        .run();
    });
    applyChannelWrites(id, data, channelSource);
    recalcEnrichment(id);
    return getContactById(id);
  }

  db.update(contacts)
    .set({ ...updates, updatedAt: now })
    .where(eq(contacts.id, id))
    .run();

  applyChannelWrites(id, data, channelSource);
  recalcEnrichment(id);
  return getContactById(id);
}

export function getOwnerContactId(): string | null {
  const rows = db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.isSelf, true))
    .orderBy(contacts.createdAt)
    .all();
  return rows[0]?.id ?? null;
}

export function deleteContact(id: string): boolean {
  const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!existing) return false;

  db.transaction((tx) => {
    tx.update(contentItems)
      .set({ contactId: null })
      .where(eq(contentItems.contactId, id))
      .run();
    tx.delete(tasks).where(eq(tasks.relatedContactId, id)).run();
    tx.update(workflowSteps)
      .set({ contactId: null })
      .where(eq(workflowSteps.contactId, id))
      .run();
    tx.delete(contacts).where(eq(contacts.id, id)).run();
  });

  return true;
}

export function countContacts(): number {
  const result = db.select({ value: count() }).from(contacts).get();
  return result?.value ?? 0;
}

export function countContactsWithEmail(): number {
  const result = db
    .select({ value: count() })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.channelType, "email"),
        sql`EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.id = ${contactChannels.contactId}
          AND json_extract(c.metadata, '$.archived') IS NOT 1
        )`,
      ),
    )
    .get();
  return result?.value ?? 0;
}

export function archiveContact(
  id: string,
  reason: string,
  workflowRunId?: string,
): ContactDTO | undefined {
  const contact = getContactById(id);
  if (!contact) return undefined;

  const existing: Record<string, unknown> = JSON.parse(contact.metadata ?? "{}");
  const metadata = JSON.stringify({
    ...existing,
    archived: 1,
    archivedAt: Math.floor(Date.now() / 1000),
    archiveReason: reason,
    ...(workflowRunId ? { archiveWorkflowRunId: workflowRunId } : {}),
  });

  const updates: Partial<NewContact> = { metadata };
  if (contact.isSelf) {
    updates.isSelf = false;
  }

  const updated = updateContact(id, updates);
  if (updated) {
    deleteEdgesTouchingContact(id);
  }

  return updated;
}

export function restoreContact(id: string): ContactDTO | undefined {
  const contact = getContactById(id);
  if (!contact) return undefined;

  const existing: Record<string, unknown> = JSON.parse(contact.metadata ?? "{}");
  delete existing.archived;
  delete existing.archivedAt;
  delete existing.archiveReason;
  delete existing.archiveWorkflowRunId;
  const metadata = JSON.stringify(existing);

  return updateContact(id, { metadata });
}

export function restoreContactsByWorkflowRun(workflowRunId: string): number {
  const rows = db
    .select()
    .from(contacts)
    .where(sql`json_extract(${contacts.metadata}, '$.archiveWorkflowRunId') = ${workflowRunId}`)
    .all();

  let restored = 0;
  for (const row of rows) {
    restoreContact(row.id);
    restored++;
  }
  return restored;
}

export function countArchivedContacts(): number {
  const result = db
    .select({ value: count() })
    .from(contacts)
    .where(sql`json_extract(${contacts.metadata}, '$.archived') = 1`)
    .get();
  return result?.value ?? 0;
}

export { recalcEnrichment, parseName };
