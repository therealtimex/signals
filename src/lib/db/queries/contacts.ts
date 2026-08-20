import { eq, like, and, or, desc, asc, count, inArray, exists, sql, SQL, gte, lte } from "drizzle-orm";
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
import {
  applyChannelInputs,
  applyLegacyEmailPhone,
  syncChannelInputs,
  validateChannelSync,
  type ChannelInput,
} from "@/lib/db/queries/contact-channel-writes";
import {
  applyLegacyCompanyTitle,
  syncEmploymentInputs,
  validateEmploymentSync,
  type EmploymentInput,
} from "@/lib/db/queries/contact-employment-writes";
import { attachContactDtos, getContactDtoById } from "@/lib/db/queries/contact-read-model";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import type { ContactDTO } from "@/lib/db/queries/contact-dto";
import type { Contact, NewContact, PaginatedResult, ContactIdentity } from "@/lib/db/types";
import type { CreationTag } from "@/lib/db/creation-sources";
import {
  birthFieldsFromProvenance,
  normalizeCreationProvenance,
  type CreationProvenance,
} from "@/lib/db/creation-provenance-input";
import {
  CreatedSourceDetailFilterError,
  resolveCreatedSourceDetailForFilter,
  type CreatedSource,
} from "@/lib/db/creation-sources";

export type { CreationProvenance, CreatedSourceDetailFilterError };

export type ContactWriteExtras = {
  email?: string | null;
  phone?: string | null;
  verifiedEmail?: boolean | number | null;
  channels?: ChannelInput[];
  employments?: EmploymentInput[];
  orgId?: string | null;
  company?: string | null;
  title?: string | null;
  /** Stripped on write — use contact_identities */
  platform?: string | null;
  platformUserId?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  avatarUrl?: string | null;
  photoUrl?: string | null;
  profileUrl?: string | null;
};

export type EmploymentWriteExtras = Pick<
  ContactWriteExtras,
  "employments" | "orgId" | "company" | "title"
>;

/** Contact create/update payload with optional channel shim fields. */
export type ContactWriteInput = Omit<NewContact, "id"> & ContactWriteExtras;
export type ContactUpdateInput = Partial<NewContact> & ContactWriteExtras;

/** Split a full name into firstName/lastName on the first space. */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const idx = fullName.indexOf(" ");
  if (idx === -1) return { firstName: fullName, lastName: "" };
  return { firstName: fullName.slice(0, idx), lastName: fullName.slice(idx + 1) };
}

function stripContactWriteExtras<T extends ContactWriteExtras>(
  data: T,
): Omit<T, keyof ContactWriteExtras> {
  const {
    email: _e,
    phone: _p,
    verifiedEmail: _v,
    channels: _c,
    employments: _emp,
    orgId: _orgId,
    company: _company,
    title: _title,
    platform: _plat,
    platformUserId: _puid,
    headline: _headline,
    bio: _bio,
    location: _location,
    website: _website,
    avatarUrl: _avatarUrl,
    photoUrl: _photoUrl,
    profileUrl: _profileUrl,
    ...rest
  } = data;
  return rest;
}

const BIRTH_FIELD_STRIP_KEYS = [
  "createdSource",
  "createdSourceDetail",
  "createdWorkflowRunId",
  "createdTemplateId",
] as const;

function stripBirthFields<T extends object>(data: T): T {
  const copy = { ...data } as Record<string, unknown>;
  for (const key of BIRTH_FIELD_STRIP_KEYS) {
    delete copy[key];
  }
  return copy as T;
}

function attachChannels(rows: Contact[]): ContactDTO[] {
  return attachContactDtos(rows);
}

function applyChannelWrites(
  contactId: string,
  extras: ContactWriteExtras | undefined,
  source: string,
): void {
  if (!extras) return;

  if (extras.channels !== undefined) {
    syncChannelInputs(contactId, extras.channels, source);
  }

  const legacy: {
    email?: string | null;
    phone?: string | null;
    verifiedEmail?: boolean | number | null;
  } = {};
  if (extras.email !== undefined) legacy.email = extras.email;
  if (extras.phone !== undefined) legacy.phone = extras.phone;
  if (extras.verifiedEmail !== undefined) legacy.verifiedEmail = extras.verifiedEmail;
  if (Object.keys(legacy).length > 0) {
    applyLegacyEmailPhone(contactId, legacy, source);
  }
}

function applyEmploymentWrites(
  contactId: string,
  extras: EmploymentWriteExtras | undefined,
  source: string,
  provenance?: CreationProvenance,
): void {
  if (!extras) return;

  if (extras.employments !== undefined) {
    syncEmploymentInputs(contactId, extras.employments, source, provenance);
  }

  const legacy: {
    company?: string | null;
    orgId?: string | null;
    title?: string | null;
  } = {};
  if (extras.orgId !== undefined) legacy.orgId = extras.orgId;
  if (extras.company !== undefined) legacy.company = extras.company;
  if (extras.title !== undefined) legacy.title = extras.title;
  if (Object.keys(legacy).length > 0) {
    applyLegacyCompanyTitle(contactId, legacy, source, provenance);
  }
}

function validateEmploymentWrites(
  contactId: string,
  extras: EmploymentWriteExtras | undefined,
): void {
  if (extras?.employments !== undefined) {
    validateEmploymentSync(contactId, extras.employments);
  }
}

function validateChannelWrites(
  contactId: string,
  extras: ContactWriteExtras | undefined,
): void {
  if (extras?.channels !== undefined) {
    validateChannelSync(contactId, extras.channels);
  }
}

function applyContactWrites(
  contactId: string,
  extras: ContactWriteExtras | undefined,
  source: string,
  provenance?: CreationProvenance,
): void {
  applyChannelWrites(contactId, extras, source);
  applyEmploymentWrites(contactId, extras, source, provenance);
}

function validateContactWrites(
  contactId: string,
  extras: ContactWriteExtras | undefined,
): void {
  validateChannelWrites(contactId, extras);
  validateEmploymentWrites(contactId, extras);
}

/** Recalculate and persist enrichment score for a contact. */
function recalcEnrichment(contactId: string): void {
  recalcContactEnrichment(contactId);
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
  createdSource?: CreatedSource;
  createdSourceDetail?: string;
  createdWorkflowRunId?: string;
  createdTemplateId?: string;
  minEnrichmentScore?: number;
  maxEnrichmentScore?: number;
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

  if (opts?.createdSource) {
    conditions.push(eq(contacts.createdSource, opts.createdSource));
  }
  if (opts?.createdSourceDetail) {
    const detail = resolveCreatedSourceDetailForFilter(opts.createdSourceDetail);
    conditions.push(eq(contacts.createdSourceDetail, detail));
  }
  if (opts?.createdWorkflowRunId) {
    conditions.push(eq(contacts.createdWorkflowRunId, opts.createdWorkflowRunId));
  }
  if (opts?.createdTemplateId) {
    conditions.push(eq(contacts.createdTemplateId, opts.createdTemplateId));
  }
  if (opts?.minEnrichmentScore !== undefined) {
    conditions.push(gte(contacts.enrichmentScore, opts.minEnrichmentScore));
  }
  if (opts?.maxEnrichmentScore !== undefined) {
    conditions.push(lte(contacts.enrichmentScore, opts.maxEnrichmentScore));
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
    .orderBy(desc(contacts.isSelf), orderByClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: attachChannels(rows), total };
}

export function getContactById(id: string): ContactDTO | undefined {
  return getContactDtoById(id);
}

export function getContactsByIds(ids: string[]): ContactDTO[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(contacts).where(inArray(contacts.id, ids)).all();
  return attachChannels(rows);
}

export function createContact(
  data: ContactWriteInput,
  provenance: CreationTag | CreationProvenance = "api:create_contact",
): ContactDTO {
  const id = nanoid();
  const rowData = stripContactWriteExtras(data);
  const normalizedProvenance = normalizeCreationProvenance(provenance);
  const birthFields = birthFieldsFromProvenance(normalizedProvenance);

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
        .values({ ...rowData, ...nameFields, ...birthFields, name, id, isSelf: true })
        .run();
    });
    applyContactWrites(id, data, normalizedProvenance.tag, normalizedProvenance);
    recalcEnrichment(id);
    return getContactById(id)!;
  }

  db.transaction(() => {
    db.insert(contacts).values({ ...rowData, ...nameFields, ...birthFields, name, id }).run();
    applyContactWrites(id, data, normalizedProvenance.tag, normalizedProvenance);
  });
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

  validateContactWrites(id, data);

  const rowUpdates = stripBirthFields(stripContactWriteExtras(data));
  const updates = { ...rowUpdates };

  if (data.firstName !== undefined || data.lastName !== undefined) {
    const fn = data.firstName ?? existing.firstName ?? "";
    const ln = data.lastName ?? existing.lastName ?? "";
    updates.name = [fn, ln].filter(Boolean).join(" ") || existing.name;
  }

  const now = Math.floor(Date.now() / 1000);

  if (data.isSelf === true) {
    db.transaction(() => {
      db.update(contacts)
        .set({ isSelf: false, updatedAt: now })
        .where(eq(contacts.isSelf, true))
        .run();
      db.update(contacts)
        .set({ ...updates, isSelf: true, updatedAt: now })
        .where(eq(contacts.id, id))
        .run();
      applyContactWrites(id, data, channelSource);
    });
    recalcEnrichment(id);
    return getContactById(id);
  }

  db.transaction(() => {
    db.update(contacts)
      .set({ ...updates, updatedAt: now })
      .where(eq(contacts.id, id))
      .run();
    applyContactWrites(id, data, channelSource);
  });
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

export function countContactsByCreatedWorkflowRun(runId: string): number {
  return (
    db
      .select({ value: count() })
      .from(contacts)
      .where(eq(contacts.createdWorkflowRunId, runId))
      .get()?.value ?? 0
  );
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
