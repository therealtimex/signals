import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { projectWorksAtFromEmployments } from "@/lib/db/employment-works-at-projection";
import { syncEmploymentScalarProjections } from "@/lib/db/contact-scalar-projection";
import { getOrgById } from "@/lib/db/queries/orgs";
import { contactEmployments, contacts } from "@/lib/db/schema";
import type { ContactEmployment, NewContactEmployment } from "@/lib/db/types";

export type ContactEmploymentWithOrg = ContactEmployment & { orgName: string };

export type CreateContactEmploymentInput = {
  contactId: string;
  orgId: string;
  title?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  isCurrent?: boolean;
  scope?: "shared" | "local_only";
  source: string;
  metadata?: Record<string, unknown>;
};

export type UpdateContactEmploymentInput = {
  orgId?: string;
  title?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  isCurrent?: boolean;
  scope?: "shared" | "local_only";
  metadata?: Record<string, unknown>;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function afterEmploymentMutation(contactId: string): void {
  recalcContactEnrichment(contactId);
  syncEmploymentScalarProjections(contactId);
  projectWorksAtFromEmployments(contactId);
}

function compareCurrentEmployments(a: ContactEmployment, b: ContactEmployment): number {
  const aStart = a.startedAt ?? -1;
  const bStart = b.startedAt ?? -1;
  if (bStart !== aStart) return bStart - aStart;
  return b.createdAt - a.createdAt;
}

export function listContactEmployments(contactId: string): ContactEmployment[] {
  return db
    .select()
    .from(contactEmployments)
    .where(eq(contactEmployments.contactId, contactId))
    .orderBy(desc(contactEmployments.isCurrent), desc(contactEmployments.startedAt), desc(contactEmployments.createdAt))
    .all();
}

export function getContactEmploymentById(id: string): ContactEmployment | undefined {
  return db.select().from(contactEmployments).where(eq(contactEmployments.id, id)).get();
}

/** Resolve current employment — latest started_at, then latest created_at (ADR-092-2). */
export function resolveCurrentEmployment(contactId: string): ContactEmploymentWithOrg | undefined {
  const rows = listContactEmployments(contactId).filter((row) => row.isCurrent);
  if (rows.length === 0) return undefined;

  const employment = [...rows].sort(compareCurrentEmployments)[0];
  const org = getOrgById(employment.orgId);
  return { ...employment, orgName: org?.name ?? "" };
}

export function createContactEmployment(input: CreateContactEmploymentInput): ContactEmployment {
  const contact = db.select().from(contacts).where(eq(contacts.id, input.contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${input.contactId}`);
  }

  const org = getOrgById(input.orgId);
  if (!org) {
    throw new Error(`Organization not found: ${input.orgId}`);
  }

  const id = nanoid();
  const now = nowUnix();

  db.insert(contactEmployments)
    .values({
      id,
      contactId: input.contactId,
      orgId: input.orgId,
      title: input.title ?? null,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      isCurrent: input.isCurrent ?? true,
      scope: input.scope ?? "shared",
      source: input.source,
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    } satisfies Omit<NewContactEmployment, "id"> & { id: string })
    .run();

  afterEmploymentMutation(input.contactId);
  return getContactEmploymentById(id)!;
}

export function updateContactEmployment(
  id: string,
  input: UpdateContactEmploymentInput,
): ContactEmployment | undefined {
  const existing = getContactEmploymentById(id);
  if (!existing) return undefined;

  if (input.orgId !== undefined) {
    const org = getOrgById(input.orgId);
    if (!org) {
      throw new Error(`Organization not found: ${input.orgId}`);
    }
  }

  const updates: Partial<NewContactEmployment> = { updatedAt: nowUnix() };
  if (input.orgId !== undefined) updates.orgId = input.orgId;
  if (input.title !== undefined) updates.title = input.title;
  if (input.startedAt !== undefined) updates.startedAt = input.startedAt;
  if (input.endedAt !== undefined) updates.endedAt = input.endedAt;
  if (input.isCurrent !== undefined) updates.isCurrent = input.isCurrent;
  if (input.scope !== undefined) updates.scope = input.scope;
  if (input.metadata !== undefined) updates.metadata = JSON.stringify(input.metadata);

  db.update(contactEmployments).set(updates).where(eq(contactEmployments.id, id)).run();
  afterEmploymentMutation(existing.contactId);
  return getContactEmploymentById(id);
}

export function deleteContactEmployment(id: string): boolean {
  const existing = getContactEmploymentById(id);
  if (!existing) return false;
  db.delete(contactEmployments).where(eq(contactEmployments.id, id)).run();
  afterEmploymentMutation(existing.contactId);
  return true;
}

/** Find employment by natural key (contact, org, title, started_at). */
export function findEmploymentByNaturalKey(
  contactId: string,
  orgId: string,
  title: string | null | undefined,
  startedAt: number | null | undefined,
): ContactEmployment | undefined {
  return db
    .select()
    .from(contactEmployments)
    .where(
      and(
        eq(contactEmployments.contactId, contactId),
        eq(contactEmployments.orgId, orgId),
        title == null
          ? sql`${contactEmployments.title} IS NULL`
          : eq(contactEmployments.title, title),
        startedAt == null
          ? sql`${contactEmployments.startedAt} IS NULL`
          : eq(contactEmployments.startedAt, startedAt),
      ),
    )
    .get();
}

/** Delete all employments for a contact (legacy clear / full sync helper). */
export function deleteAllContactEmployments(contactId: string, runner: DbRunner = db): number {
  const rows = runner
    .select({ id: contactEmployments.id })
    .from(contactEmployments)
    .where(eq(contactEmployments.contactId, contactId))
    .all();

  for (const row of rows) {
    runner.delete(contactEmployments).where(eq(contactEmployments.id, row.id)).run();
  }
  return rows.length;
}
