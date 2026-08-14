import { and, eq, like, desc, count, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";
import { normalizeOrgName, orgDedupeKey } from "@/lib/db/backfills/org-names";
import type { Org, PaginatedResult } from "@/lib/db/types";

export function listOrgs(opts?: {
  search?: string;
  page?: number;
  pageSize?: number;
  includeLocalOnly?: boolean;
}): PaginatedResult<Org> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(orgs.scope, "shared"));
  }

  if (opts?.search) {
    conditions.push(like(orgs.name, `%${opts.search}%`));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ value: count() }).from(orgs).where(where).get()?.value ?? 0;
  const data = db
    .select()
    .from(orgs)
    .where(where)
    .orderBy(desc(orgs.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

export function getOrgById(id: string): Org | undefined {
  return db.select().from(orgs).where(eq(orgs.id, id)).get();
}

/** Find or create an org by normalized company name. */
export function ensureOrgByName(name: string, source = "agent"): Org {
  const displayName = normalizeOrgName(name);
  const key = orgDedupeKey(displayName);

  const existing = db
    .select()
    .from(orgs)
    .all()
    .find((org) => orgDedupeKey(org.name) === key);

  if (existing) return existing;

  const id = nanoid();
  db.insert(orgs)
    .values({
      id,
      name: displayName,
      source,
      scope: "shared",
    })
    .run();

  return db.select().from(orgs).where(eq(orgs.id, id)).get()!;
}
