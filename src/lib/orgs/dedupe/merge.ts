import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employmentFoldUpdates,
  pickEmploymentFoldTarget,
} from "@/lib/db/employment-fold";
import { afterEmploymentMutation } from "@/lib/db/queries/contact-employments";
import { recalcOrgEnrichment } from "@/lib/db/queries/orgs";
import { mergedIntoOrgId, resolveSurvivingOrgId } from "@/lib/orgs/tombstone";
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
    db.update(orgEmailPatterns).set({ orgId: primaryId }).where(inArray(orgEmailPatterns.id, movable)).run();
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
  for (const side of ["src", "dst"] as const) {
    const typeCol = side === "src" ? graphEdges.srcType : graphEdges.dstType;
    const idCol = side === "src" ? graphEdges.srcId : graphEdges.dstId;

    const rows = db
      .select()
      .from(graphEdges)
      .where(and(eq(typeCol, "org"), eq(idCol, secondaryId)))
      .all();
    if (rows.length === 0) continue;

    const survivorKeys = new Set(
      db
        .select()
        .from(graphEdges)
        .where(and(eq(typeCol, "org"), eq(idCol, primaryId)))
        .all()
        .map((row) => `${row.edgeType} ${row.srcType} ${row.srcId} ${row.dstType} ${row.dstId}`),
    );

    const collisions: string[] = [];
    const movable: string[] = [];
    for (const row of rows) {
      const projected =
        side === "src"
          ? `${row.edgeType} ${row.srcType} ${primaryId} ${row.dstType} ${row.dstId}`
          : `${row.edgeType} ${row.srcType} ${row.srcId} ${row.dstType} ${primaryId}`;
      // A self-edge would be created if the other end is the survivor; drop rather than point at self.
      const selfEdge =
        side === "src" ? row.dstType === "org" && row.dstId === primaryId : row.srcType === "org" && row.srcId === primaryId;
      if (selfEdge || survivorKeys.has(projected)) collisions.push(row.id);
      else {
        movable.push(row.id);
        survivorKeys.add(projected);
      }
    }

    if (collisions.length > 0) {
      db.delete(graphEdges).where(inArray(graphEdges.id, collisions)).run();
      bump(dropped, "graphEdges", collisions.length);
    }
    if (movable.length > 0) {
      db.update(graphEdges)
        .set(side === "src" ? { srcId: primaryId } : { dstId: primaryId })
        .where(inArray(graphEdges.id, movable))
        .run();
      bump(moved, "graphEdges", movable.length);
    }
  }
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

/** Fill only where the survivor is empty; never overwrite a curated value (§4). */
const FILLABLE_FIELDS = ["industry", "description", "location", "companySize", "website"] as const;

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

  const tags = new Set<string>();
  for (const raw of [primary.tags, secondary.tags]) {
    try {
      const parsed: unknown = JSON.parse(raw ?? "[]");
      if (Array.isArray(parsed)) for (const tag of parsed) if (typeof tag === "string") tags.add(tag);
    } catch {
      // A non-JSON tags column is left alone rather than guessed at.
    }
  }
  const mergedTags = [...tags];
  if (mergedTags.length > 0) updates.tags = JSON.stringify(mergedTags);

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
      const existingTarget = mergedIntoOrgId(secondary.metadata);
      if (existingTarget) {
        merged.push({
          orgId: secondaryId,
          name: secondary.name,
          status: "already_merged",
          detail: `Already merged into ${existingTarget}`,
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
