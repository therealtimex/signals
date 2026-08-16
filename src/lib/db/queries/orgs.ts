import { and, eq, like, desc, count, or, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contacts, graphEdges, orgs } from "@/lib/db/schema";
import { normalizeOrgName, orgDedupeKey } from "@/lib/db/backfills/org-names";
import { getContactsByIds } from "@/lib/db/queries/contacts";
import type { ContactWithIdentities, Org, PaginatedResult } from "@/lib/db/types";

export type OrgRelationshipQueryOptions = {
  includeLocalOnly?: boolean;
};

export type OrgListRow = Org & { contactCount: number };

export type OrgLinkedContact = ContactWithIdentities & {
  worksAtTitle: string | null;
};

export type CreateOrgInput = {
  name: string;
  orgType?: Org["orgType"];
  domain?: string | null;
  website?: string | null;
  description?: string | null;
  location?: string | null;
  source?: string;
};

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
    const term = `%${opts.search}%`;
    conditions.push(or(like(orgs.name, term), like(orgs.domain, term))!);
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

export function listOrgsWithContactCounts(
  opts?: Parameters<typeof listOrgs>[0],
): PaginatedResult<OrgListRow> {
  const result = listOrgs(opts);
  const relationshipOpts: OrgRelationshipQueryOptions = {
    includeLocalOnly: opts?.includeLocalOnly,
  };
  return {
    total: result.total,
    data: result.data.map((org) => ({
      ...org,
      contactCount: countOrgLinkedContacts(org.id, relationshipOpts),
    })),
  };
}

function worksAtEdgeConditions(
  orgId: string,
  opts?: OrgRelationshipQueryOptions,
): SQL[] {
  const conditions: SQL[] = [
    eq(graphEdges.dstType, "org"),
    eq(graphEdges.dstId, orgId),
    eq(graphEdges.srcType, "contact"),
    eq(graphEdges.edgeType, "works_at"),
  ];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(graphEdges.scope, "shared"));
  }

  return conditions;
}

export function countOrgLinkedContacts(
  orgId: string,
  opts?: OrgRelationshipQueryOptions,
): number {
  return (
    db
      .select({ value: count() })
      .from(graphEdges)
      .where(and(...worksAtEdgeConditions(orgId, opts)))
      .get()?.value ?? 0
  );
}

export function listOrgLinkedContacts(
  orgId: string,
  opts?: OrgRelationshipQueryOptions,
): OrgLinkedContact[] {
  const edges = db
    .select()
    .from(graphEdges)
    .where(and(...worksAtEdgeConditions(orgId, opts)))
    .all();

  if (edges.length === 0) return [];

  const titleByContactId = new Map<string, string | null>();
  for (const edge of edges) {
    let title: string | null = null;
    try {
      const props = JSON.parse(edge.properties ?? "{}") as { title?: string | null };
      title = props.title ?? null;
    } catch {
      title = null;
    }
    titleByContactId.set(edge.srcId, title);
  }

  const contactsWithIdentities = getContactsByIds([...titleByContactId.keys()]);
  return contactsWithIdentities.map((contact) => ({
    ...contact,
    worksAtTitle: titleByContactId.get(contact.id) ?? contact.title ?? null,
  }));
}

export function createOrg(input: CreateOrgInput): Org {
  const displayName = normalizeOrgName(input.name);
  if (!displayName) {
    throw new Error("Organization name is required");
  }

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
      orgType: input.orgType ?? "company",
      domain: input.domain ?? null,
      website: input.website ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
      source: input.source ?? "ui",
      scope: "shared",
    })
    .run();

  return db.select().from(orgs).where(eq(orgs.id, id)).get()!;
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
