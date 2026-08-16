import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  createContactEmployment,
  deleteContactEmployment,
  findEmploymentByNaturalKey,
  getContactEmploymentById,
  listContactEmployments,
  resolveCurrentEmployment,
  updateContactEmployment,
  type CreateContactEmploymentInput,
} from "@/lib/db/queries/contact-employments";
import { ensureOrgByName, getOrgById } from "@/lib/db/queries/orgs";
import { contactEmployments } from "@/lib/db/schema";
import type { ContactEmployment } from "@/lib/db/types";

export class EmploymentWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmploymentWriteError";
  }
}

export type EmploymentInput = {
  id?: string;
  orgId?: string;
  orgName?: string;
  title?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  isCurrent?: boolean;
  scope?: "shared" | "local_only";
};

function activeEmploymentInputs(employments: EmploymentInput[]): EmploymentInput[] {
  return employments.filter((employment) => employment.orgId?.trim() || employment.orgName?.trim());
}

function resolveOrgId(input: EmploymentInput, source: string): string {
  if (input.orgId?.trim()) {
    const org = getOrgById(input.orgId.trim());
    if (!org) {
      throw new EmploymentWriteError(`Organization not found: ${input.orgId}`);
    }
    return org.id;
  }

  const orgName = input.orgName?.trim() ?? "";
  if (!orgName) {
    throw new EmploymentWriteError("orgId or orgName is required for an employment");
  }

  return ensureOrgByName(orgName, source).id;
}

/** Validate a full employment sync before any mutation. */
export function validateEmploymentSync(contactId: string, employments: EmploymentInput[]): void {
  const active = activeEmploymentInputs(employments);
  const incomingIds = new Set(
    active.map((employment) => employment.id).filter((id): id is string => Boolean(id)),
  );

  for (const id of incomingIds) {
    const row = getContactEmploymentById(id);
    if (!row) {
      throw new EmploymentWriteError(`Employment not found: ${id}`);
    }
    if (row.contactId !== contactId) {
      throw new EmploymentWriteError(`Employment ${id} does not belong to contact ${contactId}`);
    }
  }

  for (const employment of active) {
    if (employment.id) continue;
    if (employment.orgId?.trim()) {
      if (!getOrgById(employment.orgId.trim())) {
        throw new EmploymentWriteError(`Organization not found: ${employment.orgId}`);
      }
      continue;
    }
    if (!employment.orgName?.trim()) {
      throw new EmploymentWriteError("orgId or orgName is required for an employment");
    }
  }
}

export function ensureContactEmployment(
  input: CreateContactEmploymentInput,
): ContactEmployment {
  const existing = findEmploymentByNaturalKey(
    input.contactId,
    input.orgId,
    input.title,
    input.startedAt,
  );

  if (!existing) {
    return createContactEmployment(input);
  }

  const updates: Parameters<typeof updateContactEmployment>[1] = {};
  if (input.endedAt !== undefined) updates.endedAt = input.endedAt;
  if (input.isCurrent !== undefined) updates.isCurrent = input.isCurrent;
  if (input.scope !== undefined) updates.scope = input.scope;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  return updateContactEmployment(existing.id, updates) ?? existing;
}

function updateEmploymentInPlace(contactId: string, employment: EmploymentInput, source: string): void {
  if (!employment.id) {
    throw new EmploymentWriteError("Employment id is required for in-place update");
  }

  const existing = getContactEmploymentById(employment.id);
  if (!existing) {
    throw new EmploymentWriteError(`Employment not found: ${employment.id}`);
  }
  if (existing.contactId !== contactId) {
    throw new EmploymentWriteError(
      `Employment ${employment.id} does not belong to contact ${contactId}`,
    );
  }

  const orgId = employment.orgId || employment.orgName ? resolveOrgId(employment, source) : existing.orgId;

  updateContactEmployment(employment.id, {
    orgId,
    title: employment.title,
    startedAt: employment.startedAt,
    endedAt: employment.endedAt,
    isCurrent: employment.isCurrent,
    scope: employment.scope,
  });
}

export function applyEmploymentInputs(
  contactId: string,
  employments: EmploymentInput[],
  source: string,
): void {
  for (const employment of employments) {
    if (!employment.orgId?.trim() && !employment.orgName?.trim()) continue;

    if (employment.id) {
      updateEmploymentInPlace(contactId, employment, source);
      continue;
    }

    const orgId = resolveOrgId(employment, source);
    ensureContactEmployment({
      contactId,
      orgId,
      title: employment.title ?? null,
      startedAt: employment.startedAt ?? null,
      endedAt: employment.endedAt ?? null,
      isCurrent: employment.isCurrent ?? true,
      scope: employment.scope,
      source,
    });
  }
}

/** Replace the contact's employment set with the provided inputs (full sync). */
export function syncEmploymentInputs(
  contactId: string,
  employments: EmploymentInput[],
  source: string,
): void {
  validateEmploymentSync(contactId, employments);

  const active = activeEmploymentInputs(employments);
  const incomingIds = new Set(
    active.map((employment) => employment.id).filter((id): id is string => Boolean(id)),
  );
  const existing = listContactEmployments(contactId);

  db.transaction(() => {
    for (const row of existing) {
      if (!incomingIds.has(row.id)) {
        deleteContactEmployment(row.id);
      }
    }

    applyEmploymentInputs(contactId, active, source);
  });
}

function syncLegacySingleEmployment(
  contactId: string,
  orgId: string,
  title: string | null | undefined,
  source: string,
): void {
  const employments = listContactEmployments(contactId);
  for (const employment of employments) {
    if (employment.orgId !== orgId) {
      deleteContactEmployment(employment.id);
    }
  }

  const existingAtOrg = employments.find((employment) => employment.orgId === orgId);
  if (existingAtOrg) {
    updateContactEmployment(existingAtOrg.id, {
      title: title ?? null,
      isCurrent: true,
    });
    return;
  }

  createContactEmployment({
    contactId,
    orgId,
    title: title ?? null,
    isCurrent: true,
    source,
  });
}

function clearLegacyEmployments(contactId: string): void {
  const employments = listContactEmployments(contactId);
  for (const employment of employments) {
    deleteContactEmployment(employment.id);
  }
}

export function applyLegacyCompanyTitle(
  contactId: string,
  fields: {
    company?: string | null;
    orgId?: string | null;
    title?: string | null;
  },
  source: string,
): void {
  if (fields.company !== undefined || fields.orgId !== undefined) {
    const companyEmpty = fields.company === null || fields.company === "";
    const orgEmpty =
      fields.orgId === undefined || fields.orgId === null || fields.orgId === "";

    if (companyEmpty && orgEmpty) {
      clearLegacyEmployments(contactId);
      return;
    }

    let orgId = fields.orgId?.trim() || undefined;
    if (!orgId) {
      const company = fields.company?.trim() ?? "";
      if (!company) return;
      orgId = ensureOrgByName(company, source).id;
    } else {
      const org = getOrgById(orgId);
      if (!org) {
        throw new EmploymentWriteError(`Organization not found: ${orgId}`);
      }
    }

    syncLegacySingleEmployment(contactId, orgId, fields.title, source);
    return;
  }

  if (fields.title !== undefined) {
    const current = resolveCurrentEmployment(contactId);
    if (current) {
      updateContactEmployment(current.id, { title: fields.title ?? null });
      return;
    }

    const row = db.select().from(contactEmployments).where(eq(contactEmployments.contactId, contactId)).get();
    if (row) {
      updateContactEmployment(row.id, { title: fields.title ?? null });
    }
  }
}
