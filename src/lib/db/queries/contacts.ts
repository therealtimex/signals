import { eq, like, and, or, desc, asc, count, inArray, isNotNull, sql, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contacts, contactIdentities, contentItems, tasks, workflowSteps } from "@/lib/db/schema";
import { deleteEdgesTouchingContact } from "@/lib/db/graph-integrity";
import { calculateEnrichmentScore } from "@/lib/db/enrichment";
import type { Contact, NewContact, ContactWithIdentities, PaginatedResult } from "@/lib/db/types";

/** Split a full name into firstName/lastName on the first space. */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const idx = fullName.indexOf(" ");
  if (idx === -1) return { firstName: fullName, lastName: "" };
  return { firstName: fullName.slice(0, idx), lastName: fullName.slice(idx + 1) };
}

/** Batch-fetch identities for a set of contacts, returning ContactWithIdentities[]. */
function attachIdentities(rows: Contact[]): ContactWithIdentities[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const allIdentities = db
    .select()
    .from(contactIdentities)
    .where(inArray(contactIdentities.contactId, ids))
    .all();

  const map = new Map<string, typeof allIdentities>();
  for (const identity of allIdentities) {
    const list = map.get(identity.contactId) ?? [];
    list.push(identity);
    map.set(identity.contactId, list);
  }

  return rows.map((row) => ({
    ...row,
    identities: map.get(row.id) ?? [],
  }));
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
  const score = calculateEnrichmentScore(contact, identities);
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
}): PaginatedResult<ContactWithIdentities> {
  const conditions: SQL[] = [];

  // Exclude archived contacts by default
  if (!opts?.includeArchived) {
    conditions.push(sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`);
  }
  // Exclude platform-actor shadow contacts (legacy workaround cleanup)
  conditions.push(sql`json_extract(${contacts.metadata}, '$.platformActor') IS NOT 1`);

  if (opts?.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(contacts.name, pattern),
        like(contacts.firstName, pattern),
        like(contacts.lastName, pattern),
        like(contacts.email, pattern),
      )!
    );
  }
  if (opts?.funnelStage) {
    conditions.push(eq(contacts.funnelStage, opts.funnelStage as Contact["funnelStage"]));
  }
  if (opts?.platform) {
    conditions.push(
      eq(contacts.platform, opts.platform as "x" | "linkedin" | "gmail" | "substack")
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total = db
    .select({ value: count() })
    .from(contacts)
    .where(whereClause)
    .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const sortField =
    opts?.sort === "enrichmentScore" ? contacts.enrichmentScore : contacts.createdAt;
  const orderDirection = opts?.order ?? (opts?.sort === "enrichmentScore" ? "asc" : "desc");
  const orderByClause =
    orderDirection === "asc" ? asc(sortField) : desc(sortField);

  const rows = db
    .select()
    .from(contacts)
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data: attachIdentities(rows), total };
}

export function getContactById(id: string): ContactWithIdentities | undefined {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return undefined;
  return attachIdentities([row])[0];
}

export function getContactsByIds(ids: string[]): ContactWithIdentities[] {
  if (ids.length === 0) return [];
  const rows = db.select().from(contacts).where(inArray(contacts.id, ids)).all();
  return attachIdentities(rows);
}

/**
 * Find an existing contact by exact email match or case-insensitive name match.
 * Email takes priority (more reliable). Returns undefined if no match.
 */
export function findContactByNameOrEmail(
  name: string,
  email?: string | null
): ContactWithIdentities | undefined {
  // Try exact email match first (most reliable identifier)
  if (email) {
    const byEmail = db.select().from(contacts).where(eq(contacts.email, email)).get();
    if (byEmail) return attachIdentities([byEmail])[0];
  }
  // Fall back to case-insensitive exact name match
  const byName = db
    .select()
    .from(contacts)
    .where(sql`lower(${contacts.name}) = lower(${name})`)
    .get();
  if (byName) return attachIdentities([byName])[0];
  return undefined;
}

export function createContact(data: Omit<NewContact, "id">): ContactWithIdentities {
  const id = nanoid();

  // Auto-parse name into firstName/lastName if not provided
  const nameFields =
    !data.firstName && !data.lastName && data.name
      ? parseName(data.name)
      : {};

  // Compute full name from firstName + lastName if name is not explicitly set
  const name =
    data.name ||
    [data.firstName, data.lastName].filter(Boolean).join(" ") ||
    "Unknown";

  const now = Math.floor(Date.now() / 1000);

  if (data.isSelf === true) {
    db.transaction((tx) => {
      tx.update(contacts)
        .set({ isSelf: false, updatedAt: now })
        .where(eq(contacts.isSelf, true))
        .run();
      tx.insert(contacts)
        .values({ ...data, ...nameFields, name, id, isSelf: true })
        .run();
    });
    recalcEnrichment(id);
    return getContactById(id)!;
  }

  db.insert(contacts).values({ ...data, ...nameFields, name, id }).run();
  recalcEnrichment(id);
  return getContactById(id)!;
}

export function updateContact(
  id: string,
  data: Partial<NewContact>
): ContactWithIdentities | undefined {
  const existing = getContactById(id);
  if (!existing) return undefined;

  // If firstName or lastName changed, recompute name
  const updates = { ...data };
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
    recalcEnrichment(id);
    return getContactById(id);
  }

  db.update(contacts)
    .set({ ...updates, updatedAt: now })
    .where(eq(contacts.id, id))
    .run();

  recalcEnrichment(id);
  return getContactById(id);
}

/** Owner contact for relationship chips; lowest created_at wins if invariant violated. */
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
    // Unlink content items (nullable FK — preserve content, just remove contact reference)
    tx.update(contentItems)
      .set({ contactId: null })
      .where(eq(contentItems.contactId, id))
      .run();
    // Delete tasks tied to this contact
    tx.delete(tasks)
      .where(eq(tasks.relatedContactId, id))
      .run();
    // Unlink workflow steps (nullable FK — preserve step history)
    tx.update(workflowSteps)
      .set({ contactId: null })
      .where(eq(workflowSteps.contactId, id))
      .run();
    // Now safe to delete the contact (cascades handle identities, enrollments, engagements)
    tx.delete(contacts).where(eq(contacts.id, id)).run();
  });

  return true;
}

export function countContacts(): number {
  const result = db.select({ value: count() }).from(contacts).get();
  return result?.value ?? 0;
}

/** Count non-archived contacts that have an email address. */
export function countContactsWithEmail(): number {
  const result = db
    .select({ value: count() })
    .from(contacts)
    .where(
      and(
        isNotNull(contacts.email),
        sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`
      )
    )
    .get();
  return result?.value ?? 0;
}

/** Archive a contact with a reason, optionally linking to the workflow run that triggered it. */
export function archiveContact(
  id: string,
  reason: string,
  workflowRunId?: string
): ContactWithIdentities | undefined {
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

/** Restore a previously archived contact by clearing archive keys from metadata. */
export function restoreContact(id: string): ContactWithIdentities | undefined {
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

/** Restore all contacts archived by a specific workflow run. Returns count restored. */
export function restoreContactsByWorkflowRun(workflowRunId: string): number {
  const rows = db
    .select()
    .from(contacts)
    .where(sql`json_extract(${contacts.metadata}, '$.archiveWorkflowRunId') = ${workflowRunId}`)
    .all();

  let count = 0;
  for (const row of rows) {
    restoreContact(row.id);
    count++;
  }
  return count;
}

/** Count archived contacts. */
export function countArchivedContacts(): number {
  const result = db
    .select({ value: count() })
    .from(contacts)
    .where(sql`json_extract(${contacts.metadata}, '$.archived') = 1`)
    .get();
  return result?.value ?? 0;
}

/** Exposed for data migration use. */
export { recalcEnrichment, parseName };
