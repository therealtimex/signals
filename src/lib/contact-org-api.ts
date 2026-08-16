import {
  syncContactCompanyGraph,
  syncContactOrgGraph,
} from "@/lib/db/contact-org-dual-write";
import { getOrgById } from "@/lib/db/queries/orgs";

export type ContactOrgInput = {
  orgId?: string | null;
  company?: string | null;
  title?: string | null;
};

export type ResolvedContactCompany =
  | { company: string | null; orgId?: string; touched: true }
  | { touched: false };

function isOrgCleared(input: ContactOrgInput): boolean {
  return (
    (input.orgId === null || input.orgId === "") &&
    (input.company === null || input.company === "")
  );
}

/** Resolve `contacts.company` from API org fields (`orgId` preferred over free-text `company`). */
export function resolveContactCompanyFields(
  input: ContactOrgInput,
): ResolvedContactCompany | { error: string } {
  if (input.orgId === undefined && input.company === undefined) {
    return { touched: false };
  }

  if (isOrgCleared(input)) {
    return { company: null, touched: true };
  }

  if (input.orgId) {
    const org = getOrgById(input.orgId);
    if (!org) {
      return { error: "Organization not found" };
    }
    return { company: org.name, orgId: org.id, touched: true };
  }

  const trimmed = input.company?.trim() ?? "";
  return { company: trimmed || null, touched: true };
}

export function shouldSyncCompanyGraphOnUpdate(input: ContactOrgInput): boolean {
  return input.orgId !== undefined || input.company !== undefined || input.title !== undefined;
}

export function applyContactOrgLink(
  contactId: string,
  resolved: { company: string | null; orgId?: string },
  source: "api:create_contact" | "api:update_contact",
  title?: string | null,
): void {
  if (resolved.company === null) {
    syncContactCompanyGraph(contactId, null, title, source);
    return;
  }

  if (resolved.orgId) {
    syncContactOrgGraph(contactId, resolved.orgId, title, source);
    return;
  }

  syncContactCompanyGraph(contactId, resolved.company, title, source);
}

export function syncContactCompanyFromContact(
  contactId: string,
  company: string | null | undefined,
  title: string | null | undefined,
  source: "api:create_contact" | "api:update_contact",
): void {
  applyContactOrgLink(contactId, { company: company ?? null }, source, title);
}
