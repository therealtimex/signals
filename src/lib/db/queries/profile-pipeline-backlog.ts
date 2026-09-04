import { and, asc, count, eq, exists, inArray, not, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contactIdentities,
  contactPersonas,
  contacts,
  contentItems,
  contentPosts,
  interactions,
  mediaAttachments,
} from "@/lib/db/schema";
import type { ContactIdentity } from "@/lib/db/types";
import { PERSONA_STALE_AFTER_SECONDS } from "@/lib/persona/staleness";

export const AVATAR_ENRICH_RETRY_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long a transiently-failed avatar sits out. The resolver's daily quota resets on roughly this
 * cadence, and without a cooldown a throttled batch is re-selected every run — the queue order is
 * deterministic, so head-of-line blocking starves every contact behind it.
 */
export const AVATAR_THROTTLE_COOLDOWN_SECONDS = 6 * 60 * 60;
export const PROFILE_PIPELINE_MAX_BATCH = 50;

const DEFAULT_BATCH_SIZE = 20;

export type ProfilePipelineFilters = {
  platform?: string;
  maxEnrichmentScore?: number;
  needsAvatar?: boolean;
  needsPersona?: boolean;
  personaStale?: boolean;
};

export type ProfilePipelineRunInput = {
  batchSize?: number;
  contactIds?: string[];
  filters?: ProfilePipelineFilters;
  forcePersona?: boolean;
};

export type ProfilePipelineRunPlan = {
  backlogTotal: number;
  batchSize: number;
  selectedContactIds: string[];
  filters: ProfilePipelineFilters;
  orderBy: "enrichmentScore ASC, updatedAt ASC, id ASC";
  explicit: boolean;
};

export class ProfilePipelineValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(
    message: string,
    readonly invalidContactIds: string[],
  ) {
    super(message);
    this.name = "ProfilePipelineValidationError";
  }
}

type ResolvedProfilePipelineFilters = {
  platform?: string;
  maxEnrichmentScore?: number;
  needsAvatar: boolean;
  needsPersona: boolean;
  personaStale: boolean;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function resolveProfilePipelineFilters(
  filters?: ProfilePipelineFilters,
): ResolvedProfilePipelineFilters {
  return {
    platform: filters?.platform,
    maxEnrichmentScore: filters?.maxEnrichmentScore,
    needsAvatar: filters?.needsAvatar ?? true,
    needsPersona: filters?.needsPersona ?? true,
    personaStale: filters?.personaStale ?? false,
  };
}

function resolveBatchSize(batchSize?: number): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize <= 0) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.min(Math.max(1, Math.floor(batchSize)), PROFILE_PIPELINE_MAX_BATCH);
}

function universeConditions(): SQL[] {
  return [
    sql`json_extract(${contacts.metadata}, '$.archived') IS NOT 1`,
    eq(contacts.isSelf, false),
    sql`json_extract(${contacts.metadata}, '$.platformActor') IS NOT 1`,
  ];
}

function hasActiveIdentity(): SQL {
  return exists(
    db
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(
        and(eq(contactIdentities.contactId, contacts.id), eq(contactIdentities.isActive, 1)),
      ),
  );
}

function hasAvatarMediaAttachment(): SQL {
  return exists(
    db
      .select({ id: mediaAttachments.id })
      .from(mediaAttachments)
      .where(
        and(
          eq(mediaAttachments.parentType, "contact"),
          eq(mediaAttachments.parentId, contacts.id),
          eq(mediaAttachments.role, "avatar"),
        ),
      ),
  );
}

function needsAvatarPredicate(now: number): SQL {
  const retryCutoff = now - AVATAR_ENRICH_RETRY_SECONDS;
  const throttleCutoff = now - AVATAR_THROTTLE_COOLDOWN_SECONDS;
  // A locally cached avatar is the only completion signal. A remote identity URL is *not* done:
  // it still has to be pulled local, or it breaks the moment the resolver throttles (#431).
  return and(
    hasActiveIdentity(),
    not(hasAvatarMediaAttachment()),
    sql`json_extract(${contacts.metadata}, '$.avatarEnrich.gravatarVerifiedAt') IS NULL`,
    or(
      sql`json_extract(${contacts.metadata}, '$.avatarEnrich.exhaustedAt') IS NULL`,
      sql`json_extract(${contacts.metadata}, '$.avatarEnrich.exhaustedAt') < ${retryCutoff}`,
    )!,
    or(
      sql`json_extract(${contacts.metadata}, '$.avatarEnrich.throttledAt') IS NULL`,
      sql`json_extract(${contacts.metadata}, '$.avatarEnrich.throttledAt') < ${throttleCutoff}`,
    )!,
  )!;
}

function hasActivePersonaAnyScope(): SQL {
  return exists(
    db
      .select({ id: contactPersonas.id })
      .from(contactPersonas)
      .where(
        and(eq(contactPersonas.contactId, contacts.id), eq(contactPersonas.status, "active")),
      ),
  );
}

function hasEvidenceSufficiency(): SQL {
  return or(
    hasActiveIdentity(),
    exists(
      db
        .select({ id: contentItems.id })
        .from(contentItems)
        .innerJoin(contentPosts, eq(contentPosts.contentItemId, contentItems.id))
        .where(
          and(
            eq(contentItems.contactId, contacts.id),
            sql`${contentItems.contentType} NOT IN ('email', 'dm')`,
            sql`${contentPosts.publishedAt} IS NOT NULL`,
          ),
        ),
    )!,
    sql`(
      SELECT COUNT(*) FROM ${interactions}
      WHERE ${interactions.contactId} = ${contacts.id}
      AND ${interactions.scope} = 'shared'
    ) >= 3`,
  )!;
}

function needsPersonaPredicate(): SQL {
  return and(not(hasActivePersonaAnyScope()), hasEvidenceSufficiency())!;
}

function personaStalePredicate(now: number): SQL {
  const staleCutoff = now - PERSONA_STALE_AFTER_SECONDS;
  return exists(
    db
      .select({ id: contactPersonas.id })
      .from(contactPersonas)
      .where(
        and(
          eq(contactPersonas.contactId, contacts.id),
          eq(contactPersonas.status, "active"),
          eq(contactPersonas.scope, "shared"),
          sql`${contactPersonas.generatedAt} < ${staleCutoff}`,
        ),
      ),
  );
}

function platformFilter(platform: string): SQL {
  return exists(
    db
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(
        and(
          eq(contactIdentities.contactId, contacts.id),
          eq(contactIdentities.isActive, 1),
          eq(contactIdentities.platform, platform as ContactIdentity["platform"]),
        ),
      ),
  );
}

function buildBacklogPredicate(resolved: ResolvedProfilePipelineFilters, now: number): SQL | undefined {
  const parts: SQL[] = [];
  if (resolved.needsAvatar) parts.push(needsAvatarPredicate(now));
  if (resolved.needsPersona) parts.push(needsPersonaPredicate());
  if (resolved.personaStale) parts.push(personaStalePredicate(now));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : or(...parts)!;
}

function buildWhereClause(
  resolved: ResolvedProfilePipelineFilters,
  now: number,
  extra?: SQL[],
): SQL | undefined {
  const conditions: SQL[] = [...universeConditions()];
  const backlog = buildBacklogPredicate(resolved, now);
  if (!backlog) return undefined;
  conditions.push(backlog);
  if (resolved.platform) conditions.push(platformFilter(resolved.platform));
  if (resolved.maxEnrichmentScore != null) {
    conditions.push(sql`${contacts.enrichmentScore} <= ${resolved.maxEnrichmentScore}`);
  }
  if (extra?.length) conditions.push(...extra);
  return and(...conditions);
}

function isContactInUniverse(metadata: string | null, isSelf: boolean): boolean {
  if (isSelf) return false;
  const parsed = JSON.parse(metadata ?? "{}") as { archived?: number; platformActor?: number };
  return parsed.archived !== 1 && parsed.platformActor !== 1;
}

function validateExplicitContactIds(contactIds: string[]): string[] {
  const invalid: string[] = [];
  const validated: string[] = [];

  for (const contactId of contactIds) {
    const row = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    if (!row || !isContactInUniverse(row.metadata, row.isSelf)) {
      invalid.push(contactId);
      continue;
    }
    validated.push(contactId);
  }

  if (invalid.length > 0) {
    throw new ProfilePipelineValidationError(
      `Invalid contact ids: ${invalid.join(", ")}`,
      invalid,
    );
  }

  return validated;
}

export function countProfilePipelineBacklog(filters?: ProfilePipelineFilters): number {
  const resolved = resolveProfilePipelineFilters(filters);
  const whereClause = buildWhereClause(resolved, nowUnix());
  if (!whereClause) return 0;

  const result = db.select({ value: count() }).from(contacts).where(whereClause).get();
  return result?.value ?? 0;
}

/** Count backlog matches restricted to a set of contact ids (explicit-mode remaining/cleared). */
export function countProfilePipelineBacklogAmong(
  contactIds: string[],
  filters?: ProfilePipelineFilters,
): number {
  if (contactIds.length === 0) return 0;
  const resolved = resolveProfilePipelineFilters(filters);
  const whereClause = buildWhereClause(resolved, nowUnix(), [inArray(contacts.id, contactIds)]);
  if (!whereClause) return 0;

  const result = db.select({ value: count() }).from(contacts).where(whereClause).get();
  return result?.value ?? 0;
}

function selectBacklogContactIds(
  resolved: ResolvedProfilePipelineFilters,
  limit: number,
  now: number,
): string[] {
  const whereClause = buildWhereClause(resolved, now);
  if (!whereClause) return [];

  return db
    .select({ id: contacts.id })
    .from(contacts)
    .where(whereClause)
    .orderBy(asc(contacts.enrichmentScore), asc(contacts.updatedAt), asc(contacts.id))
    .limit(limit)
    .all()
    .map((row) => row.id);
}

export function planProfilePipelineRun(input?: ProfilePipelineRunInput): ProfilePipelineRunPlan {
  const resolved = resolveProfilePipelineFilters(input?.filters);
  const filters: ProfilePipelineFilters = {
    ...(resolved.platform ? { platform: resolved.platform } : {}),
    ...(resolved.maxEnrichmentScore != null
      ? { maxEnrichmentScore: resolved.maxEnrichmentScore }
      : {}),
    needsAvatar: resolved.needsAvatar,
    needsPersona: resolved.needsPersona,
    personaStale: resolved.personaStale,
  };

  if (input?.contactIds != null) {
    const validated = validateExplicitContactIds(input.contactIds);
    const batchSize = Math.min(validated.length, PROFILE_PIPELINE_MAX_BATCH);
    return {
      backlogTotal: input.contactIds.length,
      batchSize,
      selectedContactIds: validated.slice(0, PROFILE_PIPELINE_MAX_BATCH),
      filters,
      orderBy: "enrichmentScore ASC, updatedAt ASC, id ASC",
      explicit: true,
    };
  }

  const batchSize = resolveBatchSize(input?.batchSize);
  const backlogTotal = countProfilePipelineBacklog(filters);
  const selectedContactIds = selectBacklogContactIds(resolved, batchSize, nowUnix());

  return {
    backlogTotal,
    batchSize,
    selectedContactIds,
    filters,
    orderBy: "enrichmentScore ASC, updatedAt ASC, id ASC",
    explicit: false,
  };
}

export const PIPELINE_PLANNERS = {
  contact_profile: {
    countBacklog: countProfilePipelineBacklog,
    planRun: planProfilePipelineRun,
  },
} as const;
