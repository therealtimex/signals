import { and, asc, eq, like, desc, count, or, isNotNull, isNull, sql, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { contacts, graphEdges, orgDomains, orgs } from "@/lib/db/schema";
import { normalizeOrgName, orgDedupeKey } from "@/lib/db/backfills/org-names";
import { resolveSurvivingOrgId } from "@/lib/orgs/tombstone";
import { getContactsByIds } from "@/lib/db/queries/contacts";
import type { ContactWithIdentities, Org, PaginatedResult } from "@/lib/db/types";
import { listOrgIdentitiesByOrg } from "@/lib/db/queries/org-identities";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import {
  birthFieldsFromProvenance,
  normalizeCreationProvenance,
  type CreationProvenance,
} from "@/lib/db/creation-provenance-input";
import type { CreationTag } from "@/lib/db/creation-sources";
import { normalizeOrgWebsiteUrl } from "@/lib/org-website";
import { normalizeOrgDomain } from "@/lib/orgs/domain";
import { OrgDomainConflictError, OrgValidationError } from "@/lib/orgs/errors";
import { getOrgEnrichmentState } from "@/lib/orgs/enrichment";
import { logOrgActivity } from "@/lib/db/queries/org-activities";
import { serializeOrgDTO, type OrgDTO } from "@/lib/serializers/org";

export type OrgRelationshipQueryOptions = {
  includeLocalOnly?: boolean;
};

export type OrgListRow = Org & {
  contactCount: number;
  /** Names of a few linked people, for the row subtitle. Orgs hold little else worth showing. */
  linkedContactNames: string[];
};

/**
 * Filters restricted to org fields that actually carry data. `accountStage`, `followedAt`,
 * `ownerContactId` and `industry` are near-empty across a real install (#442), so exposing them as
 * list filters would be chrome with nothing behind it.
 */
export type OrgListPeopleFilter = "any" | "multiple" | "unlinked";
export type OrgListSource = "any" | "import" | "agent";
export type OrgListSort = "updated" | "people" | "name";

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
  avatarUrl?: string | null;
  industry?: string | null;
  companySize?: Org["companySize"];
  tags?: string[];
  ownerContactId?: string | null;
  accountStage?: Org["accountStage"];
  source?: string;
  provenance?: CreationTag | CreationProvenance;
};

export type OrgUpdateInput = Partial<
  Pick<
    Org,
    | "name"
    | "orgType"
    | "domain"
    | "website"
    | "description"
    | "location"
    | "avatarUrl"
    | "industry"
    | "companySize"
    | "ownerContactId"
    | "accountStage"
  >
> & { tags?: string[] };

export type OrgWriteProvenance = {
  source: "manual" | "agent" | "import" | "sync" | "api" | "derived";
  tag: string;
  workflowRunId?: string | null;
  evidenceUrl?: string | null;
  fieldSources?: Record<string, { evidenceUrl?: string | null }>;
};

function parseOrgMetadata(metadata: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metadata ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDomainInput(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const result = normalizeOrgDomain(value);
  if (!result.ok) {
    throw new OrgValidationError(result.message, { field: "domain", code: result.code });
  }
  return result.domain;
}

function normalizeWebsiteInput(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeOrgWebsiteUrl(value);
  } catch {
    throw new OrgValidationError("Invalid website URL", { field: "website" });
  }
}

export function listOrgs(opts?: {
  search?: string;
  page?: number;
  pageSize?: number;
  includeLocalOnly?: boolean;
  stage?: Org["accountStage"];
  owner?: string;
  followed?: boolean;
  tag?: string;
  people?: OrgListPeopleFilter;
  source?: OrgListSource;
  sort?: OrgListSort;
}): PaginatedResult<Org> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(orgs.scope, "shared"));
  }

  // A merged-away org keeps its row as a tombstone and its name as an alias, but it is not a
  // company anyone should browse (ADR-445-3).
  conditions.push(sql`json_extract(${orgs.metadata}, '$.archived') IS NOT 1`);

  if (opts?.search) {
    const term = `%${opts.search}%`;
    conditions.push(or(like(orgs.name, term), like(orgs.domain, term))!);
  }
  if (opts?.stage) conditions.push(eq(orgs.accountStage, opts.stage));
  if (opts?.owner) conditions.push(eq(orgs.ownerContactId, opts.owner));
  if (opts?.followed === true) conditions.push(isNotNull(orgs.followedAt));
  if (opts?.followed === false) conditions.push(isNull(orgs.followedAt));
  if (opts?.tag) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM json_each(COALESCE(${orgs.tags}, '[]'))
      WHERE json_each.value = ${opts.tag}
    )`);
  }

  if (opts?.source === "import") {
    conditions.push(sql`${orgs.createdSourceDetail} LIKE 'import:%'`);
  }
  if (opts?.source === "agent") {
    conditions.push(sql`${orgs.createdSourceDetail} LIKE 'agent:%'`);
  }

  // Linked people live on the graph edge, not a column, so this counts rather than joins.
  const linkedCount = sql`(
    SELECT COUNT(*) FROM ${graphEdges}
     WHERE ${graphEdges.dstType} = 'org' AND ${graphEdges.dstId} = ${orgs.id}
       AND ${graphEdges.srcType} = 'contact' AND ${graphEdges.edgeType} = 'works_at'
       ${opts?.includeLocalOnly ? sql`` : sql`AND ${graphEdges.scope} = 'shared'`}
  )`;
  if (opts?.people === "multiple") conditions.push(sql`${linkedCount} > 1`);
  if (opts?.people === "unlinked") conditions.push(sql`${linkedCount} = 0`);

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ value: count() }).from(orgs).where(where).get()?.value ?? 0;

  const orderBy = (() => {
    if (opts?.sort === "name") return [asc(orgs.name)];
    if (opts?.sort === "people") return [desc(linkedCount), desc(orgs.updatedAt)];
    return [desc(orgs.updatedAt)];
  })();

  const data = db
    .select()
    .from(orgs)
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

export function getOrgById(id: string): Org | undefined {
  return db.select().from(orgs).where(eq(orgs.id, id)).get();
}

export function getOrgByDomain(domain: string): Org | undefined {
  const normalized = normalizeDomainInput(domain);
  if (!normalized) return undefined;
  const identity = db
    .select({ orgId: orgDomains.orgId })
    .from(orgDomains)
    .where(eq(orgDomains.domain, normalized))
    .get();
  return identity
    ? getOrgById(identity.orgId)
    : db.select().from(orgs).where(eq(orgs.domain, normalized)).get();
}

function syncPrimaryDomain(
  orgId: string,
  previousDomain: string | null,
  nextDomain: string | null,
  source: string,
): void {
  const now = Math.floor(Date.now() / 1000);
  if (previousDomain && previousDomain !== nextDomain) {
    db.insert(orgDomains)
      .values({
        id: nanoid(),
        orgId,
        domain: previousDomain,
        kind: "alias",
        source,
      })
      .onConflictDoNothing({ target: orgDomains.domain })
      .run();
  }

  db.update(orgDomains)
    .set({ kind: "alias", updatedAt: now })
    .where(and(eq(orgDomains.orgId, orgId), eq(orgDomains.kind, "primary")))
    .run();

  if (!nextDomain) return;
  const existing = db.select().from(orgDomains).where(eq(orgDomains.domain, nextDomain)).get();
  if (existing) {
    db.update(orgDomains)
      .set({ kind: "primary", source, updatedAt: now })
      .where(eq(orgDomains.id, existing.id))
      .run();
    return;
  }
  db.insert(orgDomains)
    .values({ id: nanoid(), orgId, domain: nextDomain, kind: "primary", source })
    .run();
}

export function addOrgDomainAlias(
  orgId: string,
  value: string,
  source = "manual:add_org_domain_alias",
) {
  const org = getOrgById(orgId);
  if (!org) return undefined;
  const domain = normalizeDomainInput(value);
  if (!domain) {
    throw new OrgValidationError("Company domain is required.", { field: "domain" });
  }
  const claimed = getOrgByDomain(domain);
  if (claimed && claimed.id !== orgId) throw new OrgDomainConflictError(domain, claimed.id);
  const existing = db.select().from(orgDomains).where(eq(orgDomains.domain, domain)).get();
  if (existing) return existing;
  const id = nanoid();
  db.insert(orgDomains).values({ id, orgId, domain, kind: "alias", source }).run();
  return db.select().from(orgDomains).where(eq(orgDomains.id, id)).get()!;
}

export function removeOrgDomainAlias(orgId: string, value: string): boolean {
  const domain = normalizeDomainInput(value);
  if (!domain) {
    throw new OrgValidationError("Company domain is required.", { field: "domain" });
  }
  const existing = db
    .select()
    .from(orgDomains)
    .where(and(eq(orgDomains.orgId, orgId), eq(orgDomains.domain, domain)))
    .get();
  if (!existing || existing.kind === "primary") return false;
  db.delete(orgDomains).where(eq(orgDomains.id, existing.id)).run();
  return true;
}

export function getOrgDTO(id: string): OrgDTO | undefined {
  const org = getOrgById(id);
  if (!org) return undefined;
  const createdTemplateName = org.createdTemplateId
    ? getTemplate(org.createdTemplateId)?.name ?? null
    : null;
  return serializeOrgDTO({
    org,
    domains: db
      .select({ domain: orgDomains.domain, kind: orgDomains.kind })
      .from(orgDomains)
      .where(eq(orgDomains.orgId, id))
      .all(),
    identities: listOrgIdentitiesByOrg(id),
    owner: org.ownerContactId
      ? db
          .select({ contactId: contacts.id, name: contacts.name })
          .from(contacts)
          .where(eq(contacts.id, org.ownerContactId))
          .get() ?? null
      : null,
    enrichment: getOrgEnrichmentState(id),
    createdTemplateName,
  });
}

export function updateOrg(
  id: string,
  patch: OrgUpdateInput,
  provenance: OrgWriteProvenance,
): Org | undefined {
  const existing = getOrgById(id);
  if (!existing) return undefined;

  const updates: Partial<Org> = {};
  const touchedFields: string[] = [];
  const set = <K extends Exclude<keyof OrgUpdateInput, "tags">>(
    key: K,
    value: OrgUpdateInput[K],
  ) => {
    if (value !== undefined) {
      Object.assign(updates, { [key]: value });
      touchedFields.push(key);
    }
  };

  if (patch.name !== undefined) {
    const name = normalizeOrgName(patch.name);
    if (!name) {
      throw new OrgValidationError("Company name is required.", { field: "name" });
    }
    set("name", name);
  }
  set("orgType", patch.orgType);

  const domain = normalizeDomainInput(patch.domain);
  if (domain !== undefined && domain !== null) {
    const claimed = getOrgByDomain(domain);
    if (claimed && claimed.id !== id) throw new OrgDomainConflictError(domain, claimed.id);
  }
  set("domain", domain);
  set("website", normalizeWebsiteInput(patch.website));
  set("description", patch.description);
  set("location", patch.location);
  set("avatarUrl", patch.avatarUrl);
  set("industry", patch.industry);
  set("companySize", patch.companySize);
  if (patch.tags !== undefined) {
    const normalizedTags = new Set<string>();
    for (const tag of patch.tags) {
      const normalized = tag.trim();
      if (normalized) normalizedTags.add(normalized);
    }
    updates.tags = JSON.stringify([...normalizedTags]);
    touchedFields.push("tags");
  }
  set("ownerContactId", patch.ownerContactId);
  set("accountStage", patch.accountStage);

  if (patch.ownerContactId) {
    const owner = db
      .select({ isSelf: contacts.isSelf })
      .from(contacts)
      .where(eq(contacts.id, patch.ownerContactId))
      .get();
    if (!owner?.isSelf) {
      throw new OrgValidationError("Company owner must be one of your profiles.", {
        field: "ownerContactId",
      });
    }
  }

  if (touchedFields.length === 0) return existing;

  const metadata = parseOrgMetadata(existing.metadata);
  const currentFieldProvenance =
    typeof metadata.fieldProvenance === "object" &&
    metadata.fieldProvenance !== null &&
    !Array.isArray(metadata.fieldProvenance)
      ? (metadata.fieldProvenance as Record<string, unknown>)
      : {};
  const now = Math.floor(Date.now() / 1000);
  for (const field of touchedFields) {
    const evidenceUrl = provenance.fieldSources?.[field]?.evidenceUrl ?? provenance.evidenceUrl;
    currentFieldProvenance[field] = {
      source: provenance.source,
      tag: provenance.tag,
      at: now,
      ...(provenance.workflowRunId ? { workflowRunId: provenance.workflowRunId } : {}),
      ...(evidenceUrl ? { evidenceUrl } : {}),
    };
  }
  metadata.fieldProvenance = currentFieldProvenance;
  updates.metadata = JSON.stringify(metadata);
  updates.updatedAt = now;

  db.update(orgs).set(updates).where(eq(orgs.id, id)).run();
  if (domain !== undefined) {
    syncPrimaryDomain(id, existing.domain, domain, provenance.tag);
  }
  recalcOrgEnrichment(id);
  logOrgActivity({
    orgId: id,
    activityType: provenance.tag === "agent:enrich_org" ? "profile_enriched" : "profile_updated",
    title: provenance.tag === "agent:enrich_org" ? "Company profile enriched" : "Company profile updated",
    source: provenance.tag,
    workflowRunId: provenance.workflowRunId,
    metadata: { fields: touchedFields },
    dedupeKey: provenance.workflowRunId
      ? `${provenance.tag}:${provenance.workflowRunId}`
      : `${provenance.tag}:${id}:${now}:${touchedFields.join(",")}`,
  });
  return getOrgById(id);
}

export function recalcOrgEnrichment(orgId: string): number {
  const org = getOrgById(orgId);
  if (!org) return 0;
  const present = [
    org.domain,
    org.website,
    org.description,
    org.industry,
    org.companySize,
    org.location,
    org.avatarUrl,
    listOrgIdentitiesByOrg(orgId).length > 0,
    countOrgLinkedContacts(orgId) > 0,
    org.ownerContactId,
    org.accountStage,
  ].filter(Boolean).length;
  const score = Math.round((present / 11) * 100);
  if (score !== org.enrichmentScore) {
    db.update(orgs).set({ enrichmentScore: score }).where(eq(orgs.id, orgId)).run();
  }
  return score;
}

export function countOrgsByCreatedWorkflowRun(runId: string): number {
  return (
    db
      .select({ value: count() })
      .from(orgs)
      .where(eq(orgs.createdWorkflowRunId, runId))
      .get()?.value ?? 0
  );
}

/**
 * A company page stored as a contact links to its own org, so "Clearbit · Clearbit" would read as
 * if the company employed itself. The count still includes it; only the name list drops it.
 */
function pickLinkedContactNames(
  org: Org,
  relationshipOpts: OrgRelationshipQueryOptions,
  limit = 3,
): string[] {
  const selfKey = org.name.trim().toLowerCase();
  const names: string[] = [];
  for (const contact of listOrgLinkedContacts(org.id, relationshipOpts)) {
    if (contact.name.trim().toLowerCase() === selfKey) continue;
    names.push(contact.name);
    if (names.length === limit) break;
  }
  return names;
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
      // A company page stored as a contact links to its own org, so "Clearbit · Clearbit" would
      // otherwise read as if the company employed itself. The count still includes it; only the
      // name list drops it, since naming the org again tells the reader nothing.
      linkedContactNames: pickLinkedContactNames(org, relationshipOpts),
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
  if (existing) {
    const fillGaps: OrgUpdateInput = {};
    if (!existing.domain && input.domain !== undefined) fillGaps.domain = input.domain;
    if (!existing.website && input.website !== undefined) fillGaps.website = input.website;
    if (!existing.description && input.description !== undefined) {
      fillGaps.description = input.description;
    }
    if (!existing.location && input.location !== undefined) fillGaps.location = input.location;
    if (!existing.avatarUrl && input.avatarUrl !== undefined) fillGaps.avatarUrl = input.avatarUrl;
    if (!existing.industry && input.industry !== undefined) fillGaps.industry = input.industry;
    if (!existing.companySize && input.companySize !== undefined) {
      fillGaps.companySize = input.companySize;
    }
    if ((!existing.tags || existing.tags === "[]") && input.tags !== undefined) {
      fillGaps.tags = input.tags;
    }
    if (!existing.ownerContactId && input.ownerContactId !== undefined) {
      fillGaps.ownerContactId = input.ownerContactId;
    }
    if (!existing.accountStage && input.accountStage !== undefined) {
      fillGaps.accountStage = input.accountStage;
    }
    return (
      updateOrg(existing.id, fillGaps, {
        source: "derived",
        tag: "derived:create_org_fill_gaps",
      }) ?? existing
    );
  }

  const domain = normalizeDomainInput(input.domain) ?? null;
  const website = normalizeWebsiteInput(input.website) ?? null;
  if (domain) {
    const claimed = getOrgByDomain(domain);
    if (claimed) throw new OrgDomainConflictError(domain, claimed.id);
  }
  if (input.ownerContactId) {
    const owner = db
      .select({ isSelf: contacts.isSelf })
      .from(contacts)
      .where(eq(contacts.id, input.ownerContactId))
      .get();
    if (!owner?.isSelf) {
      throw new OrgValidationError("Company owner must be one of your profiles.", {
        field: "ownerContactId",
      });
    }
  }

  const id = nanoid();
  const birthFields = input.provenance
    ? birthFieldsFromProvenance(normalizeCreationProvenance(input.provenance))
    : {};
  db.insert(orgs)
    .values({
      id,
      name: displayName,
      orgType: input.orgType ?? "company",
      domain,
      website,
      description: input.description ?? null,
      location: input.location ?? null,
      avatarUrl: input.avatarUrl ?? null,
      industry: input.industry ?? null,
      companySize: input.companySize ?? null,
      tags: JSON.stringify(input.tags ?? []),
      ownerContactId: input.ownerContactId ?? null,
      accountStage: input.accountStage ?? null,
      source: input.source ?? "ui",
      scope: "shared",
      ...birthFields,
    })
    .run();

  if (domain) syncPrimaryDomain(id, null, domain, input.provenance ? normalizeCreationProvenance(input.provenance).tag : "api:create_org");

  recalcOrgEnrichment(id);

  return db.select().from(orgs).where(eq(orgs.id, id)).get()!;
}

/** Find or create an org by normalized company name. */
export function ensureOrgByName(
  name: string,
  source = "agent",
  provenance?: CreationProvenance,
): Org {
  const displayName = normalizeOrgName(name);
  const key = orgDedupeKey(displayName);

  const existing = db
    .select()
    .from(orgs)
    .all()
    .find((org) => orgDedupeKey(org.name) === key);

  if (existing) {
    // The tombstone keeps its name, which is what lets it act as the secondary's alias. Resolve
    // through the chain rather than skipping: skipping would mint a third record and the merge
    // would quietly un-happen on the next import (ADR-445-3).
    const surviving = resolveSurvivingOrgId(existing.id);
    if (surviving === existing.id) return existing;
    const survivor = db.select().from(orgs).where(eq(orgs.id, surviving)).get();
    if (survivor) return survivor;
    return existing;
  }

  const id = nanoid();
  const birthFields = provenance
    ? birthFieldsFromProvenance(normalizeCreationProvenance(provenance))
    : {};
  db.insert(orgs)
    .values({
      id,
      name: displayName,
      source,
      scope: "shared",
      ...birthFields,
    })
    .run();

  return db.select().from(orgs).where(eq(orgs.id, id)).get()!;
}

/** Find or create an org by email domain (work email org projection). */
export function ensureOrgByDomain(
  domain: string,
  source = "email_domain",
  provenance?: CreationProvenance,
): Org {
  const normalized = normalizeDomainInput(domain);
  if (!normalized) throw new OrgValidationError("Domain is required", { field: "domain" });

  const byDomain = getOrgByDomain(normalized);
  if (byDomain) return byDomain;

  const name = normalized.split(".")[0] ?? normalized;
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  const id = nanoid();
  const birthFields = provenance
    ? birthFieldsFromProvenance(normalizeCreationProvenance(provenance))
    : {};
  db.insert(orgs)
    .values({
      id,
      name: displayName,
      domain: normalized,
      orgType: "company",
      source,
      scope: "shared",
      ...birthFields,
    })
    .run();

  syncPrimaryDomain(id, null, normalized, "derived:email_domain");
  recalcOrgEnrichment(id);

  return db.select().from(orgs).where(eq(orgs.id, id)).get()!;
}
