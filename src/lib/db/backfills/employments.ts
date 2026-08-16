import { eq, and } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { db, sqlite as defaultSqlite } from "@/lib/db/client";
import { getContactWorksAtOrgId } from "@/lib/db/contact-org-dual-write";
import { projectWorksAtFromEmployments } from "@/lib/db/employment-works-at-projection";
import { ensureOrgByName } from "@/lib/db/queries/orgs";
import {
  findEmploymentByNaturalKey,
  listContactEmployments,
} from "@/lib/db/queries/contact-employments";
import { ensureContactEmployment } from "@/lib/db/queries/contact-employment-writes";
import { contactEmployments } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";

const SOURCE = "backfill:contacts-company-title";

type ScalarRow = {
  id: string;
  company: string | null;
  title: string | null;
};

function readScalarRows(runner: Database.Database): ScalarRow[] {
  try {
    return runner
      .prepare(
        `SELECT id, company, title
         FROM contacts
         WHERE company IS NOT NULL`,
      )
      .all() as ScalarRow[];
  } catch {
    return [];
  }
}

function contactsHasCompanyColumn(runner: Database.Database): boolean {
  const rows = runner.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  return rows.some((row) => row.name === "company");
}

/** Backfill company/title scalars into `contact_employments` (idempotent). */
export function backfillEmploymentsWithDb(
  runner: BetterSQLite3Database<typeof schema>,
  sqliteRunner: Database.Database = defaultSqlite,
): { inserted: number; skipped: number } {
  const rows = readScalarRows(sqliteRunner);
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const company = row.company?.trim() ?? "";
    if (!company) {
      skipped++;
      continue;
    }

    const preferredOrgId = getContactWorksAtOrgId(row.id);
    const orgId = preferredOrgId ?? ensureOrgByName(company, SOURCE).id;

    const existing = findEmploymentByNaturalKey(row.id, orgId, row.title, null);
    if (existing) {
      skipped++;
      continue;
    }

    ensureContactEmployment({
      contactId: row.id,
      orgId,
      title: row.title ?? null,
      isCurrent: true,
      source: SOURCE,
    });
    inserted++;
  }

  const contactIds = [
    ...new Set([
      ...rows.map((row) => row.id),
      ...runner.select({ contactId: contactEmployments.contactId }).from(contactEmployments).all().map((row) => row.contactId),
    ]),
  ];
  for (const contactId of contactIds) {
    projectWorksAtFromEmployments(contactId, SOURCE);
  }

  return { inserted, skipped };
}

export function backfillEmployments(): { inserted: number; skipped: number } {
  return backfillEmploymentsWithDb(db, defaultSqlite);
}

export function countContactsWithScalarCompany(): number {
  if (!contactsHasCompanyColumn(defaultSqlite)) return 0;
  return readScalarRows(defaultSqlite).filter((row) => row.company?.trim()).length;
}

export function countEmployments(): number {
  return db.select().from(contactEmployments).all().length;
}

export function countScalarCompaniesMissingEmployment(): number {
  if (!contactsHasCompanyColumn(defaultSqlite)) return 0;

  let missing = 0;
  for (const row of readScalarRows(defaultSqlite)) {
    const company = row.company?.trim();
    if (!company) continue;
    const preferredOrgId = getContactWorksAtOrgId(row.id);
    const employments = listContactEmployments(row.id);
    const hasMatch = employments.some(
      (employment) =>
        employment.orgId === preferredOrgId ||
        (!preferredOrgId && employment.title === (row.title ?? null)),
    );
    if (!hasMatch) missing++;
  }
  return missing;
}

export function countEmploymentsForContact(contactId: string): number {
  return db
    .select()
    .from(contactEmployments)
    .where(eq(contactEmployments.contactId, contactId))
    .all().length;
}

export function countCurrentEmploymentsForContact(contactId: string): number {
  return db
    .select()
    .from(contactEmployments)
    .where(and(eq(contactEmployments.contactId, contactId), eq(contactEmployments.isCurrent, true)))
    .all().length;
}
