import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  employmentFoldUpdates,
  pickEmploymentFoldTarget,
} from "@/lib/db/employment-fold";
import { afterEmploymentMutation } from "@/lib/db/queries/contact-employments";
import { recalcOrgEnrichment } from "@/lib/db/queries/orgs";
import { mergedIntoOrgId, resolveSurvivingOrgId } from "@/lib/orgs/tombstone";
import { describesDistinctEntities } from "@/lib/orgs/dedupe/detect";
import {
  contactEmployments,
  graphEdges,
  orgDomains,
  orgEmailPatterns,
  orgs,
} from "@/lib/db/schema";

/**
 * Merge duplicate organization records (specs/org-merge.md).
 *
 * An org is a join target rather than a leaf: the rows being re-pointed belong to contacts, tasks
 * and interactions that happen to reference the org. The secondary is tombstoned rather than
 * deleted — four of the `org_id` columns are `ON DELETE SET NULL`, so deleting would lose those
 * references silently instead of failing loudly (§3).
 */

export type OrgMergeMemberStatus = "merged" | "already_merged" | "skipped";

export interface MergeOrgsOptions {
  /** Runs the real transaction and rolls it back, so the report is exact (ADR-445-4). */
  dryRun?: boolean;
  /** Which member domain becomes the survivor's primary. Must already belong to a member. */
  domain?: string;
  /**
   * Merge a pair the duplicate detector would refuse to suggest — a venture arm into its parent,
   * a division, a regional unit (§5 guard 3). Off by default so a wrong pair cannot arrive by
   * accident from a caller that trusted the containment tier.
   */
  force?: boolean;
  reason?: string;
  workflowRunId?: string;
}

export interface MergeOrgsInput {
  primaryOrgId: string;
  secondaryOrgIds: string[];
  options?: MergeOrgsOptions;
}

export interface MergedOrgMember {
  orgId: string;
  name: string;
  status: OrgMergeMemberStatus;
  detail?: string;
}

export interface OrgMergeDomainPlan {
  primary: string | null;
  aliases: { domain: string; fromOrgId: string; source: string; mxStatus: string }[];
}

export interface OrgMergeEmploymentPlan {
  contactId: string;
  action: "fold" | "stint";
  keptId: string;
  foldedId?: string;
}

export interface MergeOrgsResult {
  primaryOrgId: string;
  primaryOrgName: string;
  merged: MergedOrgMember[];
  moved: Record<string, number>;
  dropped: Record<string, number>;
  plan: { domain: OrgMergeDomainPlan; employments: OrgMergeEmploymentPlan[] };
  dryRun: boolean;
}

/** Re-exported so the merge module is the one import site the spec's §3 contract describes. */
export { mergedIntoOrgId, resolveSurvivingOrgId };

export class MergeOrgsError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_MERGE";
  constructor(code: "NOT_FOUND" | "INVALID_MERGE", message: string) {
    super(message);
    this.name = "MergeOrgsError";
    this.code = code;
  }
}

/** Thrown to roll a dry run back. Never escapes `mergeOrgs`. */
class DryRunRollback extends Error {
  constructor(readonly result: MergeOrgsResult) {
    super("dry run");
  }
}

/** Cap so one bad invocation cannot cascade (§5). */
export const MAX_SECONDARY_ORGS = 20;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function bump(counters: Record<string, number>, key: string, by = 1): void {
  if (by <= 0) return;
  counters[key] = (counters[key] ?? 0) + by;
}

/** Re-point a plain `org_id` column. None of these carry a key that both sides could hold. */
function repointSimpleTables(primaryId: string, secondaryId: string, moved: Record<string, number>): void {
  const repoint = (key: string, run: () => number) => bump(moved, key, run());

  const count = (table: string, column: string): number =>
    Number(
      (
        db.get(
          sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ${secondaryId}`,
        ) as { n: number } | undefined
      )?.n ?? 0,
    );

  // Two primary identities would make the survivor's profile resolution ambiguous, exactly as two
  // primary contact identities do — mergeContacts demotes for the same reason.
  const survivorHasPrimaryIdentity =
    (
      db.get(
        sql`SELECT COUNT(*) AS n FROM org_identities WHERE org_id = ${primaryId} AND is_primary = 1`,
      ) as { n: number } | undefined
    )?.n ?? 0;
  if (survivorHasPrimaryIdentity > 0) {
    db.run(
      sql`UPDATE org_identities SET is_primary = 0 WHERE org_id = ${secondaryId} AND is_primary = 1`,
    );
  }

  // Plain re-points: none of these carry a key both sides could hold (ADR-445-5).
  // `org_identity_metrics` follows its identity rather than the org, so it needs no pass of its own.
  for (const [table, column, key] of [
    ["contact_email_candidates", "org_id", "contactEmailCandidates"],
    ["org_activities", "org_id", "orgActivities"],
    ["org_identities", "org_id", "orgIdentities"],
    ["simulation_agents", "org_id", "simulationAgents"],
    ["interactions", "org_id", "interactions"],
    ["tasks", "related_org_id", "tasks"],
  ] as const) {
    repoint(key, () => {
      const n = count(table, column);
      if (n > 0) {
        db.run(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${primaryId} WHERE ${sql.identifier(column)} = ${secondaryId}`,
        );
      }
      return n;
    });
  }
}

/** `(org_id, pattern)` is unique, so the survivor may already hold the same pattern (ADR-445-5). */
function mergeEmailPatterns(
  primaryId: string,
  secondaryId: string,
  moved: Record<string, number>,
  dropped: Record<string, number>,
): void {
  const existing = new Set(
    db
      .select({ pattern: orgEmailPatterns.pattern })
      .from(orgEmailPatterns)
      .where(eq(orgEmailPatterns.orgId, primaryId))
      .all()
      .map((row) => row.pattern),
  );

  const rows = db.select().from(orgEmailPatterns).where(eq(orgEmailPatterns.orgId, secondaryId)).all();
  const collisions = rows.filter((row) => existing.has(row.pattern)).map((row) => row.id);
  const movable = rows.filter((row) => !existing.has(row.pattern)).map((row) => row.id);

  if (collisions.length > 0) {
    db.delete(orgEmailPatterns).where(inArray(orgEmailPatterns.id, collisions)).run();
    bump(dropped, "orgEmailPatterns", collisions.length);
  }
  if (movable.length > 0) {
    // Two selected patterns leave the downstream email-candidate choice ambiguous (§4).
    const survivorHasSelected = db
      .select()
      .from(orgEmailPatterns)
      .where(and(eq(orgEmailPatterns.orgId, primaryId), eq(orgEmailPatterns.isSelected, true)))
      .all().length > 0;
    db.update(orgEmailPatterns)
      .set({ orgId: primaryId, ...(survivorHasSelected ? { isSelected: false } : {}) })
      .where(inArray(orgEmailPatterns.id, movable))
      .run();
    bump(moved, "orgEmailPatterns", movable.length);
  }
}

/** `(edge_type, src_type, src_id, dst_type, dst_id)` is unique in both directions. */
function mergeGraphEdges(
  primaryId: string,
  secondaryId: string,
  moved: Record<string, number>,
  dropped: Record<string, number>,
): void {
  const rows = db
    .select()
    .from(graphEdges)
    .where(
      sql`(${graphEdges.srcType} = 'org' AND ${graphEdges.srcId} = ${secondaryId})
          OR (${graphEdges.dstType} = 'org' AND ${graphEdges.dstId} = ${secondaryId})`,
    )
    .all();
  if (rows.length === 0) return;

  const identity = (edgeType: string, srcType: string, srcId: string, dstType: string, dstId: string) =>
    `${edgeType} ${srcType} ${srcId} ${dstType} ${dstId}`;

  const survivorKeys = new Set(
    db
      .select()
      .from(graphEdges)
      .where(
        sql`(${graphEdges.srcType} = 'org' AND ${graphEdges.srcId} = ${primaryId})
            OR (${graphEdges.dstType} = 'org' AND ${graphEdges.dstId} = ${primaryId})`,
      )
      .all()
      .map((row) => identity(row.edgeType, row.srcType, row.srcId, row.dstType, row.dstId)),
  );

  const collisions: string[] = [];
  const updates: { id: string; srcId: string; dstId: string }[] = [];

  for (const row of rows) {
    // Both endpoints are projected before the row is classified. Handling src and dst in separate
    // passes let a secondary→secondary edge be re-pointed once and then dropped, counting one row
    // as both moved and dropped.
    const srcId = row.srcType === "org" && row.srcId === secondaryId ? primaryId : row.srcId;
    const dstId = row.dstType === "org" && row.dstId === secondaryId ? primaryId : row.dstId;
    const key = identity(row.edgeType, row.srcType, srcId, row.dstType, dstId);

    const selfLoop = row.srcType === "org" && row.dstType === "org" && srcId === dstId;
    if (selfLoop || survivorKeys.has(key)) {
      collisions.push(row.id);
      continue;
    }
    survivorKeys.add(key);
    updates.push({ id: row.id, srcId, dstId });
  }

  if (collisions.length > 0) {
    db.delete(graphEdges).where(inArray(graphEdges.id, collisions)).run();
    bump(dropped, "graphEdges", collisions.length);
  }
  for (const update of updates) {
    db.update(graphEdges)
      .set({ srcId: update.srcId, dstId: update.dstId })
      .where(eq(graphEdges.id, update.id))
      .run();
  }
  bump(moved, "graphEdges", updates.length);
}

/**
 * Employment collisions fold by the shared rule (ADR-445-2). `works_at` edges are derived, so the
 * projection is rebuilt after the transaction rather than patched here.
 */
function mergeOrgEmployments(
  primaryId: string,
  secondaryId: string,
  moved: Record<string, number>,
  dropped: Record<string, number>,
  plan: OrgMergeEmploymentPlan[],
  touchedContacts: Set<string>,
): void {
  const incoming = db
    .select()
    .from(contactEmployments)
    .where(eq(contactEmployments.orgId, secondaryId))
    .all();
  if (incoming.length === 0) return;

  const folded: string[] = [];
  const movable: string[] = [];

  for (const row of incoming) {
    touchedContacts.add(row.contactId);
    const survivorRows = db
      .select()
      .from(contactEmployments)
      .where(
        and(eq(contactEmployments.orgId, primaryId), eq(contactEmployments.contactId, row.contactId)),
      )
      .all();

    const target = pickEmploymentFoldTarget(row, survivorRows);
    if (!target) {
      movable.push(row.id);
      plan.push({ contactId: row.contactId, action: "stint", keptId: row.id });
      continue;
    }

    const updates: Record<string, unknown> = employmentFoldUpdates(target, row);
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = nowUnix();
      db.update(contactEmployments).set(updates).where(eq(contactEmployments.id, target.id)).run();
    }
    folded.push(row.id);
    plan.push({ contactId: row.contactId, action: "fold", keptId: target.id, foldedId: row.id });
  }

  if (folded.length > 0) {
    db.delete(contactEmployments).where(inArray(contactEmployments.id, folded)).run();
    bump(dropped, "contactEmployments", folded.length);
  }
  if (movable.length > 0) {
    db.update(contactEmployments)
      .set({ orgId: primaryId })
      .where(inArray(contactEmployments.id, movable))
      .run();
    bump(moved, "contactEmployments", movable.length);
  }
}

/** `orgs.tags` is free-form text on older rows, so a non-array value is not a tag set. */
function parseTagArray(raw: string | null | undefined): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return null;
  }
}

/** Fill only where the survivor is empty; never overwrite a curated value (§4). */
const FILLABLE_FIELDS = [
  "industry",
  "description",
  "location",
  "companySize",
  "website",
  "avatarUrl",
] as const;

function fillEmptyFields(primaryId: string, secondaryId: string): void {
  const primary = db.select().from(orgs).where(eq(orgs.id, primaryId)).get();
  const secondary = db.select().from(orgs).where(eq(orgs.id, secondaryId)).get();
  if (!primary || !secondary) return;

  const updates: Record<string, unknown> = {};
  for (const field of FILLABLE_FIELDS) {
    const current = primary[field];
    const incoming = secondary[field];
    if ((current === null || current === "") && incoming !== null && incoming !== "") {
      updates[field] = incoming;
    }
  }

  // The union is only safe when the survivor's own value is a parseable array. If it holds raw
  // legacy text, writing a JSON array over it would destroy the survivor's value to gain the
  // secondary's — the one thing §4 says never to do.
  const survivorTags = parseTagArray(primary.tags);
  if (survivorTags) {
    const tags = new Set(survivorTags);
    for (const tag of parseTagArray(secondary.tags) ?? []) tags.add(tag);
    if (tags.size > survivorTags.length) updates.tags = JSON.stringify([...tags]);
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = nowUnix();
    db.update(orgs).set(updates).where(eq(orgs.id, primaryId)).run();
  }
}

/**
 * Collect every member domain, then re-point the aliases and choose the primary.
 *
 * The ordering is a real trap (ADR-445-1): re-point `org_domains` rows, then NULL the secondary's
 * `orgs.domain`, and only then set the survivor's. Any other order trips the unique index or lets
 * `getOrgByDomain`'s fallback land on the tombstone.
 */
function mergeDomains(
  primaryId: string,
  secondaryIds: string[],
  requestedPrimary: string | undefined,
  moved: Record<string, number>,
): OrgMergeDomainPlan {
  const memberIds = [primaryId, ...secondaryIds];
  const rows = db.select().from(orgDomains).where(inArray(orgDomains.orgId, memberIds)).all();
  const orgRows = db.select().from(orgs).where(inArray(orgs.id, memberIds)).all();

  const survivor = orgRows.find((row) => row.id === primaryId);
  const union = new Map<string, { fromOrgId: string; source: string; mxStatus: string }>();
  for (const row of rows) {
    if (!union.has(row.domain)) {
      union.set(row.domain, { fromOrgId: row.orgId, source: row.source, mxStatus: row.mxStatus });
    }
  }
  // `orgs.domain` can be set without an `org_domains` row on older records.
  for (const org of orgRows) {
    if (org.domain && !union.has(org.domain)) {
      union.set(org.domain, { fromOrgId: org.id, source: "orgs.domain", mxStatus: "unknown" });
    }
  }

  if (requestedPrimary && !union.has(requestedPrimary)) {
    throw new MergeOrgsError(
      "INVALID_MERGE",
      `Domain ${requestedPrimary} does not belong to any merged org. Use updateOrg to add a new domain.`,
    );
  }

  // Survivor keeps its own; adopts the first secondary's only when it has none.
  const fallback =
    survivor?.domain ??
    secondaryIds.map((id) => orgRows.find((row) => row.id === id)?.domain ?? null).find(Boolean) ??
    null;
  const nextPrimary = requestedPrimary ?? fallback;

  const repointed = rows.filter((row) => row.orgId !== primaryId);
  if (repointed.length > 0) {
    db.update(orgDomains)
      .set({ orgId: primaryId, kind: "alias", updatedAt: nowUnix() })
      .where(inArray(orgDomains.id, repointed.map((row) => row.id)))
      .run();
    bump(moved, "orgDomains", repointed.length);
  }

  // Older records carry `orgs.domain` with no `org_domains` row. Re-pointing only moves rows that
  // exist, so without materializing these first the secondary's domain is erased by the NULL below
  // rather than kept as an alias — "nothing is discarded" (ADR-445-1) has to hold for them too.
  const persisted = new Set(
    db.select().from(orgDomains).where(eq(orgDomains.orgId, primaryId)).all().map((row) => row.domain),
  );
  for (const [domain, meta] of union) {
    if (persisted.has(domain)) continue;
    db.insert(orgDomains)
      .values({
        id: nanoid(),
        orgId: primaryId,
        domain,
        kind: "alias",
        source: meta.source,
        mxStatus: meta.mxStatus as "ok" | "none" | "error" | "unknown",
      })
      .onConflictDoNothing({ target: orgDomains.domain })
      .run();
    persisted.add(domain);
    bump(moved, "orgDomains");
  }

  db.update(orgs)
    .set({ domain: null, updatedAt: nowUnix() })
    .where(and(inArray(orgs.id, secondaryIds), ne(orgs.id, primaryId)))
    .run();

  if (nextPrimary) {
    db.update(orgDomains)
      .set({ kind: "alias", updatedAt: nowUnix() })
      .where(and(eq(orgDomains.orgId, primaryId), eq(orgDomains.kind, "primary")))
      .run();
    const existing = db.select().from(orgDomains).where(eq(orgDomains.domain, nextPrimary)).get();
    if (existing) {
      db.update(orgDomains)
        .set({ orgId: primaryId, kind: "primary", updatedAt: nowUnix() })
        .where(eq(orgDomains.id, existing.id))
        .run();
    }
    db.update(orgs).set({ domain: nextPrimary, updatedAt: nowUnix() }).where(eq(orgs.id, primaryId)).run();
  }

  return {
    primary: nextPrimary,
    aliases: [...union.entries()]
      .filter(([domain]) => domain !== nextPrimary)
      .map(([domain, meta]) => ({ domain, ...meta })),
  };
}

function tombstone(secondaryId: string, primaryId: string, options: MergeOrgsOptions | undefined): void {
  const row = db.select().from(orgs).where(eq(orgs.id, secondaryId)).get();
  const metadata = parseMetadata(row?.metadata);
  const now = nowUnix();

  metadata.archived = 1;
  metadata.archivedAt = now;
  metadata.archiveReason = options?.reason ?? "merged";
  metadata.mergedIntoOrgId = primaryId;
  metadata.mergedAt = now;
  if (options?.workflowRunId) metadata.mergeWorkflowRunId = options.workflowRunId;

  db.update(orgs)
    .set({ metadata: JSON.stringify(metadata), updatedAt: now })
    .where(eq(orgs.id, secondaryId))
    .run();
}

export function mergeOrgs(input: MergeOrgsInput): MergeOrgsResult {
  const { primaryOrgId, secondaryOrgIds, options } = input;

  if (secondaryOrgIds.length === 0) {
    throw new MergeOrgsError("INVALID_MERGE", "At least one secondary org is required");
  }
  if (secondaryOrgIds.length > MAX_SECONDARY_ORGS) {
    throw new MergeOrgsError(
      "INVALID_MERGE",
      `At most ${MAX_SECONDARY_ORGS} secondary orgs can be merged in one call`,
    );
  }
  if (secondaryOrgIds.includes(primaryOrgId)) {
    throw new MergeOrgsError("INVALID_MERGE", "An org cannot be merged into itself");
  }

  const survivingPrimaryId = resolveSurvivingOrgId(primaryOrgId);
  const primary = db.select().from(orgs).where(eq(orgs.id, survivingPrimaryId)).get();
  if (!primary) throw new MergeOrgsError("NOT_FOUND", `Org not found: ${primaryOrgId}`);

  const moved: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const employmentPlan: OrgMergeEmploymentPlan[] = [];
  const merged: MergedOrgMember[] = [];
  const touchedContacts = new Set<string>();

  const run = (): MergeOrgsResult => {
    const actuallyMerged: string[] = [];

    for (const secondaryId of secondaryOrgIds) {
      const secondary = db.select().from(orgs).where(eq(orgs.id, secondaryId)).get();
      if (!secondary) {
        merged.push({ orgId: secondaryId, name: "", status: "skipped", detail: "Org not found" });
        continue;
      }
      if (secondaryId === survivingPrimaryId) {
        merged.push({
          orgId: secondaryId,
          name: secondary.name,
          status: "skipped",
          detail: "Already the surviving org",
        });
        continue;
      }
      // Tombstone first. Replaying a merge must report what happened to the record, not re-judge
      // its name: a pair merged under `force` would otherwise come back as `skipped` on replay,
      // and the retry semantics `mergeContacts` relies on would not hold.
      const existingTarget = mergedIntoOrgId(secondary.metadata);
      if (existingTarget) {
        const isSameTarget = resolveSurvivingOrgId(existingTarget) === survivingPrimaryId;
        merged.push({
          orgId: secondaryId,
          name: secondary.name,
          status: isSameTarget ? "already_merged" : "skipped",
          detail: isSameTarget ? undefined : `Already merged into ${existingTarget}`,
        });
        continue;
      }

      if (!options?.force && describesDistinctEntities(primary.name, secondary.name)) {
        merged.push({
          orgId: secondaryId,
          name: secondary.name,
          status: "skipped",
          detail:
            "Names describe distinct entities (venture arm, division, region, or shared industry). Pass force to merge anyway.",
        });
        continue;
      }

      mergeOrgEmployments(survivingPrimaryId, secondaryId, moved, dropped, employmentPlan, touchedContacts);
      mergeEmailPatterns(survivingPrimaryId, secondaryId, moved, dropped);
      mergeGraphEdges(survivingPrimaryId, secondaryId, moved, dropped);
      repointSimpleTables(survivingPrimaryId, secondaryId, moved);
      fillEmptyFields(survivingPrimaryId, secondaryId);
      tombstone(secondaryId, survivingPrimaryId, options);

      actuallyMerged.push(secondaryId);
      merged.push({ orgId: secondaryId, name: secondary.name, status: "merged" });
    }

    const domainPlan = mergeDomains(survivingPrimaryId, actuallyMerged, options?.domain, moved);

    return {
      primaryOrgId: survivingPrimaryId,
      primaryOrgName: primary.name,
      merged,
      moved,
      dropped,
      plan: { domain: domainPlan, employments: employmentPlan },
      dryRun: options?.dryRun === true,
    };
  };

  let result: MergeOrgsResult;
  if (options?.dryRun) {
    // One code path: run for real, then roll back, so the report cannot drift from the run
    // it predicts (ADR-445-4).
    try {
      db.transaction(() => {
        throw new DryRunRollback(run());
      });
      throw new MergeOrgsError("INVALID_MERGE", "Dry run did not roll back");
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
      return error.result;
    }
  }

  result = db.transaction(() => run());

  // Derived state, rebuilt outside the transaction exactly as mergeContacts does (ADR-445-2).
  for (const contactId of touchedContacts) afterEmploymentMutation(contactId);
  recalcOrgEnrichment(survivingPrimaryId);

  return result;
}
