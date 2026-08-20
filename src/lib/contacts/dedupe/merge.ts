/**
 * Lossless contact merge (#209).
 *
 * Consolidates every graph edge that hangs off a secondary contact onto a
 * surviving primary, then tombstones the secondary. The tombstone reuses the
 * existing `metadata.archived` convention (see `archiveContact`) rather than a
 * new status column, so every reader that already hides archived contacts hides
 * merged ones too.
 *
 * Two invariants the tests pin down:
 *  - Lossless: no row that pointed at a secondary is left orphaned. It is either
 *    re-pointed at the primary or dropped *because the primary already had it*.
 *  - Idempotent: re-running the same merge is a no-op that reports
 *    `already_merged`, which is what makes the CLI batch mode safe to retry.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { recalcContactEnrichment } from "@/lib/db/contact-enrichment-recalc";
import { projectWorksAtFromEmployments } from "@/lib/db/employment-works-at-projection";
import {
  contactChannels,
  contactEmployments,
  contactIdentities,
  contactPersonas,
  contacts,
  contentItems,
  embeddings,
  engagements,
  graphEdges,
  interactions,
  simulationAgents,
  tasks,
  workflowEnrollments,
  workflowSteps,
} from "@/lib/db/schema";

/**
 * Tables re-pointed with a plain UPDATE — none of them has a unique index that
 * includes the contact column, so nothing can collide on the way over.
 */
const SIMPLE_REPOINTS: {
  label: string;
  repoint: (primaryId: string, secondaryId: string) => number;
}[] = [
  {
    label: "interactions",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(interactions)
          .set({ contactId: primaryId })
          .where(eq(interactions.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "engagements",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(engagements)
          .set({ contactId: primaryId })
          .where(eq(engagements.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "contentItems",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(contentItems)
          .set({ contactId: primaryId })
          .where(eq(contentItems.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "tasks",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(tasks)
          .set({ relatedContactId: primaryId })
          .where(eq(tasks.relatedContactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "workflowEnrollments",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(workflowEnrollments)
          .set({ contactId: primaryId })
          .where(eq(workflowEnrollments.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "workflowSteps",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(workflowSteps)
          .set({ contactId: primaryId })
          .where(eq(workflowSteps.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
  {
    label: "simulationAgents",
    repoint: (primaryId, secondaryId) =>
      Number(
        db
          .update(simulationAgents)
          .set({ contactId: primaryId })
          .where(eq(simulationAgents.contactId, secondaryId))
          .run().changes ?? 0,
      ),
  },
];

export type MergeMemberStatus = "merged" | "already_merged" | "skipped";

export interface MergeContactsOptions {
  /** Default true. Set false when the caller batches its own recalculation. */
  autoRecalculateScore?: boolean;
  /** Validate and report without writing. */
  dryRun?: boolean;
  reason?: string;
  workflowRunId?: string;
}

export interface MergeContactsInput {
  primaryContactId: string;
  secondaryContactIds: string[];
  options?: MergeContactsOptions;
}

export interface MergedMember {
  contactId: string;
  name: string;
  status: MergeMemberStatus;
  detail?: string;
}

export interface MergeContactsResult {
  primaryContactId: string;
  primaryContactName: string;
  merged: MergedMember[];
  /** Rows re-pointed at the primary, per table. */
  moved: Record<string, number>;
  /** Rows dropped because the primary already held the same unique key. */
  dropped: Record<string, number>;
  enrichmentScore: number;
  dryRun: boolean;
}

export class MergeContactsError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_MERGE";
  constructor(code: "NOT_FOUND" | "INVALID_MERGE", message: string) {
    super(message);
    this.name = "MergeContactsError";
    this.code = code;
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The contact this record was merged into, or null if it is still live. */
export function mergedIntoContactId(metadata: string | null | undefined): string | null {
  const value = parseMetadata(metadata).mergedIntoContactId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Follow a tombstone chain to the contact that is actually alive.
 *
 * Needed because a staged dedup file can name a primary that a *previous* run
 * already merged away; without this, replaying the file would resurrect a
 * tombstone as a merge target.
 */
export function resolveSurvivingContactId(contactId: string, maxHops = 10): string {
  let current = contactId;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const row = db
      .select({ metadata: contacts.metadata })
      .from(contacts)
      .where(eq(contacts.id, current))
      .get();
    if (!row) return current;
    const next = mergedIntoContactId(row.metadata);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

/**
 * `contacts.tags` is a free-form text column that the API and the create_contact
 * schema both pass through as `z.string()`, so it is not guaranteed to be JSON.
 * A parse failure here would abort the whole merge transaction, so it degrades
 * to "no tags" the same way `parseMetadata` does.
 */
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

type Counters = { moved: Record<string, number>; dropped: Record<string, number> };

function bump(counters: Record<string, number>, label: string, delta: number): void {
  if (delta <= 0) return;
  counters[label] = (counters[label] ?? 0) + delta;
}

/**
 * Channels are unique per (contactId, channelType, valueNormalized), so a
 * secondary row whose key the primary already holds must be dropped, not moved.
 */
function mergeChannels(primaryId: string, secondaryId: string, counters: Counters): void {
  const primaryKeys = new Set(
    db
      .select({
        channelType: contactChannels.channelType,
        valueNormalized: contactChannels.valueNormalized,
      })
      .from(contactChannels)
      .where(eq(contactChannels.contactId, primaryId))
      .all()
      .map((row) => `${row.channelType}:${row.valueNormalized}`),
  );

  const rows = db
    .select({
      id: contactChannels.id,
      channelType: contactChannels.channelType,
      valueNormalized: contactChannels.valueNormalized,
    })
    .from(contactChannels)
    .where(eq(contactChannels.contactId, secondaryId))
    .all();

  const duplicates: string[] = [];
  const movable: string[] = [];
  for (const row of rows) {
    const key = `${row.channelType}:${row.valueNormalized}`;
    if (primaryKeys.has(key)) {
      duplicates.push(row.id);
    } else {
      primaryKeys.add(key);
      movable.push(row.id);
    }
  }

  if (duplicates.length > 0) {
    db.delete(contactChannels).where(inArray(contactChannels.id, duplicates)).run();
    bump(counters.dropped, "contactChannels", duplicates.length);
  }
  if (movable.length > 0) {
    db.update(contactChannels)
      .set({ contactId: primaryId, updatedAt: nowUnix() })
      .where(inArray(contactChannels.id, movable))
      .run();
    bump(counters.moved, "contactChannels", movable.length);
  }
}

/**
 * Identities never collide on the way over: `idx_identity_platform_user` is
 * unique on (platform, platformUserId) alone, so a claim the primary already
 * holds could not have been attached to the secondary in the first place. That
 * uniqueness is exactly the cross-claim blocker from #209 — the secondary is
 * usually the record left with zero identities.
 */
function mergeIdentities(primaryId: string, secondaryId: string, counters: Counters): void {
  const primaryHasPrimaryIdentity =
    db
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, primaryId), eq(contactIdentities.isPrimary, 1)))
      .get() !== undefined;

  const rows = db
    .select({ id: contactIdentities.id })
    .from(contactIdentities)
    .where(eq(contactIdentities.contactId, secondaryId))
    .all();
  if (rows.length === 0) return;

  db.update(contactIdentities)
    .set({
      contactId: primaryId,
      // Two isPrimary identities would make `resolveContactProfile` pick
      // arbitrarily, so the incoming ones yield to the primary's existing pick.
      ...(primaryHasPrimaryIdentity ? { isPrimary: 0 } : {}),
      updatedAt: nowUnix(),
    })
    .where(eq(contactIdentities.contactId, secondaryId))
    .run();
  bump(counters.moved, "contactIdentities", rows.length);
}

/**
 * Employment has no unique index, so a naive re-point would leave the survivor
 * holding two stints at one org. That is not just noise: `resolveCurrentEmployment`
 * breaks the tie on `createdAt`, so the secondary's thinner stint (usually no
 * title, because it came from the import that could not claim the identity) would
 * win and the survivor would *lose* its title — and five enrichment points with
 * it. So a stint at an org the primary already has is folded into the existing
 * row instead of stacked beside it.
 *
 * Genuinely different stints at the same org (a promotion history: two distinct
 * non-blank titles) still move across, because that is real history.
 */
function mergeEmployments(primaryId: string, secondaryId: string, counters: Counters): void {
  const primaryRows = db
    .select()
    .from(contactEmployments)
    .where(eq(contactEmployments.contactId, primaryId))
    .all();

  const rows = db
    .select()
    .from(contactEmployments)
    .where(eq(contactEmployments.contactId, secondaryId))
    .all();
  if (rows.length === 0) return;

  const folded: string[] = [];
  const movable: string[] = [];

  for (const row of rows) {
    const sameOrg = primaryRows.filter((existing) => existing.orgId === row.orgId);
    const target =
      sameOrg.find((existing) => normalizeTitle(existing.title) === normalizeTitle(row.title)) ??
      // A blank title on either side means "same job, less detail", not a second job.
      (normalizeTitle(row.title) === ""
        ? sameOrg[0]
        : sameOrg.find((existing) => normalizeTitle(existing.title) === ""));

    if (!target) {
      movable.push(row.id);
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (!target.title && row.title) updates.title = row.title;
    if (target.startedAt === null && row.startedAt !== null) updates.startedAt = row.startedAt;
    if (target.endedAt === null && row.endedAt !== null) updates.endedAt = row.endedAt;
    if (!target.isCurrent && row.isCurrent) updates.isCurrent = true;
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = nowUnix();
      db.update(contactEmployments).set(updates).where(eq(contactEmployments.id, target.id)).run();
      Object.assign(target, updates);
    }
    folded.push(row.id);
  }

  if (folded.length > 0) {
    db.delete(contactEmployments).where(inArray(contactEmployments.id, folded)).run();
    bump(counters.dropped, "contactEmployments", folded.length);
  }
  if (movable.length > 0) {
    db.update(contactEmployments)
      .set({ contactId: primaryId, updatedAt: nowUnix() })
      .where(inArray(contactEmployments.id, movable))
      .run();
    bump(counters.moved, "contactEmployments", movable.length);
  }
}

/** Personas are versioned; only one may stay `active` after the merge. */
function mergePersonas(primaryId: string, secondaryId: string, counters: Counters): void {
  const rows = db
    .select({ id: contactPersonas.id })
    .from(contactPersonas)
    .where(eq(contactPersonas.contactId, secondaryId))
    .all();
  if (rows.length === 0) return;

  const primaryHasActive =
    db
      .select({ id: contactPersonas.id })
      .from(contactPersonas)
      .where(and(eq(contactPersonas.contactId, primaryId), eq(contactPersonas.status, "active")))
      .get() !== undefined;

  db.update(contactPersonas)
    .set({
      contactId: primaryId,
      ...(primaryHasActive ? { status: "superseded" as const, supersededAt: nowUnix() } : {}),
      updatedAt: nowUnix(),
    })
    .where(eq(contactPersonas.contactId, secondaryId))
    .run();
  bump(counters.moved, "contactPersonas", rows.length);
}

/**
 * Graph edges are unique on (edgeType, srcType, srcId, dstType, dstId). Moving a
 * contact endpoint can therefore collide with an edge the primary already has,
 * and can also fold an edge between the two duplicates into a self-loop.
 */
function mergeGraphEdges(primaryId: string, secondaryId: string, counters: Counters): void {
  const rows = db
    .select({
      id: graphEdges.id,
      edgeType: graphEdges.edgeType,
      srcType: graphEdges.srcType,
      srcId: graphEdges.srcId,
      dstType: graphEdges.dstType,
      dstId: graphEdges.dstId,
    })
    .from(graphEdges)
    .where(
      sql`(${graphEdges.srcType} = 'contact' AND ${graphEdges.srcId} = ${secondaryId})
        OR (${graphEdges.dstType} = 'contact' AND ${graphEdges.dstId} = ${secondaryId})`,
    )
    .all();
  if (rows.length === 0) return;

  const existingKeys = new Set(
    db
      .select({
        edgeType: graphEdges.edgeType,
        srcType: graphEdges.srcType,
        srcId: graphEdges.srcId,
        dstType: graphEdges.dstType,
        dstId: graphEdges.dstId,
      })
      .from(graphEdges)
      .where(
        sql`(${graphEdges.srcType} = 'contact' AND ${graphEdges.srcId} = ${primaryId})
          OR (${graphEdges.dstType} = 'contact' AND ${graphEdges.dstId} = ${primaryId})`,
      )
      .all()
      .map((row) => `${row.edgeType}|${row.srcType}|${row.srcId}|${row.dstType}|${row.dstId}`),
  );

  const drops: string[] = [];
  let moved = 0;
  for (const row of rows) {
    const srcId = row.srcType === "contact" && row.srcId === secondaryId ? primaryId : row.srcId;
    const dstId = row.dstType === "contact" && row.dstId === secondaryId ? primaryId : row.dstId;

    // An edge that ran between the two duplicates is now a self-loop and carries
    // no information, so it goes rather than moves.
    if (row.srcType === "contact" && row.dstType === "contact" && srcId === dstId) {
      drops.push(row.id);
      continue;
    }

    const key = `${row.edgeType}|${row.srcType}|${srcId}|${row.dstType}|${dstId}`;
    if (existingKeys.has(key)) {
      drops.push(row.id);
      continue;
    }
    existingKeys.add(key);
    db.update(graphEdges)
      .set({ srcId, dstId, updatedAt: nowUnix() })
      .where(eq(graphEdges.id, row.id))
      .run();
    moved += 1;
  }

  if (drops.length > 0) {
    db.delete(graphEdges).where(inArray(graphEdges.id, drops)).run();
    bump(counters.dropped, "graphEdges", drops.length);
  }
  bump(counters.moved, "graphEdges", moved);
}

/**
 * Embeddings are unique on (nodeType, nodeId, kind, model). The secondary's
 * vector describes text we are about to fold away, so on collision the primary's
 * vector wins and the secondary's is dropped.
 */
function mergeEmbeddings(primaryId: string, secondaryId: string, counters: Counters): void {
  const primaryKeys = new Set(
    db
      .select({ kind: embeddings.kind, model: embeddings.model })
      .from(embeddings)
      .where(and(eq(embeddings.nodeType, "contact"), eq(embeddings.nodeId, primaryId)))
      .all()
      .map((row) => `${row.kind}:${row.model}`),
  );

  const rows = db
    .select({ id: embeddings.id, kind: embeddings.kind, model: embeddings.model })
    .from(embeddings)
    .where(and(eq(embeddings.nodeType, "contact"), eq(embeddings.nodeId, secondaryId)))
    .all();

  const duplicates: string[] = [];
  const movable: string[] = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.model}`;
    if (primaryKeys.has(key)) {
      duplicates.push(row.id);
    } else {
      primaryKeys.add(key);
      movable.push(row.id);
    }
  }

  if (duplicates.length > 0) {
    db.delete(embeddings).where(inArray(embeddings.id, duplicates)).run();
    bump(counters.dropped, "embeddings", duplicates.length);
  }
  if (movable.length > 0) {
    db.update(embeddings)
      .set({ nodeId: primaryId, updatedAt: nowUnix() })
      .where(inArray(embeddings.id, movable))
      .run();
    bump(counters.moved, "embeddings", movable.length);
  }
}

function repointSimple(primaryId: string, secondaryId: string, counters: Counters): void {
  for (const target of SIMPLE_REPOINTS) {
    bump(counters.moved, target.label, target.repoint(primaryId, secondaryId));
  }
}

/** True when the column holds something we can safely rewrite as a tag array. */
function hasParsableTags(raw: string | null | undefined): boolean {
  if (!raw || raw.trim() === "") return true;
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Carry scalar detail the primary is missing. Only fills blanks and unions
 * tags — a merge must never overwrite data the survivor already had.
 *
 * The caller passes a mutable `primary` row and this folds the updates back
 * into it, because an N-way merge calls this once per secondary: reading the
 * primary once and comparing every secondary against that stale snapshot would
 * let the last secondary overwrite what the earlier ones contributed.
 */
function absorbContactFields(
  primary: typeof contacts.$inferSelect,
  secondary: typeof contacts.$inferSelect,
): void {
  const updates: Record<string, unknown> = {};
  if (!primary.firstName && secondary.firstName) updates.firstName = secondary.firstName;
  if (!primary.lastName && secondary.lastName) updates.lastName = secondary.lastName;
  if (!primary.createdSource && secondary.createdSource) {
    updates.createdSource = secondary.createdSource;
    updates.createdSourceDetail = secondary.createdSourceDetail;
  }
  if (
    secondary.lastInteractionAt &&
    (!primary.lastInteractionAt || secondary.lastInteractionAt > primary.lastInteractionAt)
  ) {
    updates.lastInteractionAt = secondary.lastInteractionAt;
  }

  // Skip the union entirely when the survivor's column is non-JSON: rewriting it
  // would discard whatever it holds, which is the opposite of the point.
  if (hasParsableTags(primary.tags)) {
    const primaryTags = parseTags(primary.tags);
    const mergedTags = [...new Set([...primaryTags, ...parseTags(secondary.tags)])];
    if (mergedTags.length !== primaryTags.length) {
      updates.tags = JSON.stringify(mergedTags);
    }
  }

  if (Object.keys(updates).length === 0) return;
  updates.updatedAt = nowUnix();
  db.update(contacts).set(updates).where(eq(contacts.id, primary.id)).run();
  // Keep the in-memory row in step with the write, the same way mergeEmployments
  // does for the stint it folds into.
  Object.assign(primary, updates);
}

function tombstone(
  secondary: typeof contacts.$inferSelect,
  primaryId: string,
  options: MergeContactsOptions,
): void {
  const existing = parseMetadata(secondary.metadata);
  const reason = options.reason ?? `Merged into contact ${primaryId}`;
  const metadata = JSON.stringify({
    ...existing,
    archived: 1,
    archivedAt: nowUnix(),
    archiveReason: reason,
    mergedIntoContactId: primaryId,
    mergedAt: nowUnix(),
    ...(options.workflowRunId ? { mergeWorkflowRunId: options.workflowRunId } : {}),
  });
  db.update(contacts)
    .set({ metadata, updatedAt: nowUnix() })
    .where(eq(contacts.id, secondary.id))
    .run();
}

export function mergeContacts(input: MergeContactsInput): MergeContactsResult {
  const options = input.options ?? {};
  const dryRun = options.dryRun === true;
  const autoRecalculateScore = options.autoRecalculateScore !== false;

  const primaryId = resolveSurvivingContactId(input.primaryContactId);
  const primary = db.select().from(contacts).where(eq(contacts.id, primaryId)).get();
  if (!primary) {
    throw new MergeContactsError("NOT_FOUND", `Primary contact not found: ${input.primaryContactId}`);
  }

  const counters: Counters = { moved: {}, dropped: {} };
  const merged: MergedMember[] = [];

  const run = (): void => {
    // De-duplicated so a file listing the same secondary twice does not double-count.
    for (const rawSecondaryId of [...new Set(input.secondaryContactIds)]) {
      if (rawSecondaryId === primaryId) {
        merged.push({
          contactId: rawSecondaryId,
          name: primary.name,
          status: "skipped",
          detail: "Secondary is the primary contact",
        });
        continue;
      }

      const secondary = db.select().from(contacts).where(eq(contacts.id, rawSecondaryId)).get();
      if (!secondary) {
        merged.push({
          contactId: rawSecondaryId,
          name: "Unknown",
          status: "skipped",
          detail: "Contact not found",
        });
        continue;
      }

      if (secondary.isSelf) {
        // The workspace owner is a likely dedupe candidate (strong X identity plus
        // a Gmail-takeout twin), and archiving it would leave getOwnerContactId
        // pointing at a tombstone. Refuse rather than silently break ownership —
        // the caller should merge the duplicate into the self contact instead.
        merged.push({
          contactId: secondary.id,
          name: secondary.name,
          status: "skipped",
          detail: "Contact is the workspace owner; merge the duplicate into it instead",
        });
        continue;
      }

      const alreadyMergedInto = mergedIntoContactId(secondary.metadata);
      if (alreadyMergedInto) {
        // Replaying a merge file must be a no-op, not a second merge.
        const isSameTarget = resolveSurvivingContactId(alreadyMergedInto) === primaryId;
        merged.push({
          contactId: secondary.id,
          name: secondary.name,
          status: isSameTarget ? "already_merged" : "skipped",
          detail: isSameTarget ? undefined : `Already merged into ${alreadyMergedInto}`,
        });
        continue;
      }

      if (dryRun) {
        merged.push({ contactId: secondary.id, name: secondary.name, status: "merged" });
        continue;
      }

      mergeIdentities(primaryId, secondary.id, counters);
      mergeChannels(primaryId, secondary.id, counters);
      mergeEmployments(primaryId, secondary.id, counters);
      mergePersonas(primaryId, secondary.id, counters);
      mergeGraphEdges(primaryId, secondary.id, counters);
      mergeEmbeddings(primaryId, secondary.id, counters);
      repointSimple(primaryId, secondary.id, counters);
      absorbContactFields(primary, secondary);
      tombstone(secondary, primaryId, options);

      merged.push({ contactId: secondary.id, name: secondary.name, status: "merged" });
    }
  };

  if (dryRun) {
    run();
  } else {
    db.transaction(() => run());
  }

  const didMerge = merged.some((member) => member.status === "merged");
  if (!dryRun && didMerge) {
    // Outside the transaction: both of these read the consolidated rows back and
    // write derived state, and neither should be able to roll the merge back.
    projectWorksAtFromEmployments(primaryId);
    if (autoRecalculateScore) recalcContactEnrichment(primaryId);
  }

  const finalScore =
    db.select({ score: contacts.enrichmentScore }).from(contacts).where(eq(contacts.id, primaryId)).get()
      ?.score ?? primary.enrichmentScore;

  return {
    primaryContactId: primaryId,
    primaryContactName: primary.name,
    merged,
    moved: counters.moved,
    dropped: counters.dropped,
    enrichmentScore: finalScore,
    dryRun,
  };
}
