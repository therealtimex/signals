import { and, count, desc, eq, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { assertPlatformAccountUnclaimed, PlatformAccountConflictError } from "@/lib/db/identity-claims";
import {
  liftIdentityStatsFromPlatformData,
} from "@/lib/db/identity-stats";
import { assertPlatform } from "@/lib/db/platforms";
import { orgIdentities, orgIdentityMetrics } from "@/lib/db/schema";
import type { NewOrgIdentity, OrgIdentity, OrgIdentityMetric, PaginatedResult } from "@/lib/db/types";

const STAT_COUNT_FIELDS = [
  "followersCount",
  "followingCount",
  "postsCount",
  "listedCount",
] as const satisfies ReadonlyArray<keyof NewOrgIdentity>;

type StatCountField = (typeof STAT_COUNT_FIELDS)[number];

function normalizePlatformFields<T extends { platform: string }>(data: T): T {
  assertPlatform(data.platform);
  return data;
}

function statCountsFromIdentity(identity: Pick<NewOrgIdentity, StatCountField>): {
  followersCount: number | null | undefined;
  followingCount: number | null | undefined;
  postsCount: number | null | undefined;
  listedCount: number | null | undefined;
} {
  return {
    followersCount: identity.followersCount,
    followingCount: identity.followingCount,
    postsCount: identity.postsCount,
    listedCount: identity.listedCount,
  };
}

function statCountsChanged(
  before: Pick<NewOrgIdentity, StatCountField>,
  after: Pick<NewOrgIdentity, StatCountField>,
): boolean {
  return STAT_COUNT_FIELDS.some((field) => before[field] !== after[field]);
}

function appendOrgIdentityMetricsSnapshot(
  orgIdentityId: string,
  identity: Pick<NewOrgIdentity, StatCountField>,
): OrgIdentityMetric {
  const id = nanoid();
  db.insert(orgIdentityMetrics)
    .values({
      id,
      orgIdentityId,
      followersCount: identity.followersCount,
      followingCount: identity.followingCount,
      postsCount: identity.postsCount,
      listedCount: identity.listedCount,
    })
    .run();
  return db.select().from(orgIdentityMetrics).where(eq(orgIdentityMetrics.id, id)).get()!;
}

export function listOrgIdentities(opts?: {
  orgId?: string;
  platform?: string;
  page?: number;
  pageSize?: number;
}): PaginatedResult<OrgIdentity> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (opts?.orgId) {
    conditions.push(eq(orgIdentities.orgId, opts.orgId));
  }
  if (opts?.platform) {
    conditions.push(eq(orgIdentities.platform, assertPlatform(opts.platform)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ value: count() }).from(orgIdentities).where(where).get()?.value ?? 0;
  const data = db
    .select()
    .from(orgIdentities)
    .where(where)
    .orderBy(desc(orgIdentities.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

export function listOrgIdentitiesByOrg(orgId: string): OrgIdentity[] {
  return db.select().from(orgIdentities).where(eq(orgIdentities.orgId, orgId)).all();
}

export function getOrgIdentityById(id: string): OrgIdentity | undefined {
  return db.select().from(orgIdentities).where(eq(orgIdentities.id, id)).get();
}

export function getOrgIdentityByPlatformUser(
  platform: string,
  platformUserId: string,
): OrgIdentity | undefined {
  return db
    .select()
    .from(orgIdentities)
    .where(
      and(eq(orgIdentities.platform, platform), eq(orgIdentities.platformUserId, platformUserId)),
    )
    .get();
}

export function listOrgIdentityMetrics(
  orgIdentityId: string,
  opts?: { limit?: number },
): OrgIdentityMetric[] {
  const limit = opts?.limit ?? 50;
  return db
    .select()
    .from(orgIdentityMetrics)
    .where(eq(orgIdentityMetrics.orgIdentityId, orgIdentityId))
    .orderBy(desc(orgIdentityMetrics.snapshotAt))
    .limit(limit)
    .all();
}

function hasAnyStatCount(identity: Pick<NewOrgIdentity, StatCountField>): boolean {
  return STAT_COUNT_FIELDS.some((field) => identity[field] != null);
}

export function createOrgIdentity(data: Omit<NewOrgIdentity, "id">): OrgIdentity {
  const normalized = normalizePlatformFields(data);
  assertPlatformAccountUnclaimed(normalized.platform, normalized.platformUserId, {
    claimant: "org",
  });

  const id = nanoid();
  const lifted = liftIdentityStatsFromPlatformData(normalized.platformData, {
    statsUpdatedAt: normalized.lastSyncedAt ?? undefined,
  });

  db.insert(orgIdentities).values({ ...normalized, ...lifted, id }).run();
  const created = getOrgIdentityById(id)!;
  if (hasAnyStatCount(created)) {
    appendOrgIdentityMetricsSnapshot(id, created);
  }
  return created;
}

export function updateOrgIdentity(
  id: string,
  data: Partial<Omit<NewOrgIdentity, "id">>,
): OrgIdentity | undefined {
  const existing = getOrgIdentityById(id);
  if (!existing) return undefined;

  const nextPlatform = data.platform ?? existing.platform;
  const nextPlatformUserId = data.platformUserId ?? existing.platformUserId;
  assertPlatform(nextPlatform);
  assertPlatformAccountUnclaimed(nextPlatform, nextPlatformUserId, { claimant: "org" });

  const lifted =
    data.platformData !== undefined
      ? liftIdentityStatsFromPlatformData(data.platformData, {
          statsUpdatedAt: data.lastSyncedAt ?? existing.lastSyncedAt ?? undefined,
        })
      : {};

  const beforeCounts = statCountsFromIdentity(existing);
  db.update(orgIdentities)
    .set({
      ...data,
      ...lifted,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(orgIdentities.id, id))
    .run();

  const updated = getOrgIdentityById(id)!;
  if (statCountsChanged(beforeCounts, statCountsFromIdentity(updated))) {
    appendOrgIdentityMetricsSnapshot(id, updated);
  }
  return updated;
}

export function deleteOrgIdentityForOrg(orgId: string, identityId: string): boolean {
  const existing = db
    .select()
    .from(orgIdentities)
    .where(and(eq(orgIdentities.id, identityId), eq(orgIdentities.orgId, orgId)))
    .get();

  if (!existing) return false;

  db.delete(orgIdentities).where(eq(orgIdentities.id, identityId)).run();
  return true;
}

export type UpsertOrgIdentityInput = Omit<NewOrgIdentity, "id"> & { id?: string };

export function upsertOrgIdentity(input: UpsertOrgIdentityInput): OrgIdentity {
  const normalized = normalizePlatformFields(input);

  if (input.id) {
    const updated = updateOrgIdentity(input.id, normalized);
    if (!updated) {
      throw new Error(`Org identity not found: ${input.id}`);
    }
    if (updated.orgId !== normalized.orgId) {
      throw new Error("Org identity orgId cannot be changed via upsert");
    }
    return updated;
  }

  const existing = getOrgIdentityByPlatformUser(normalized.platform, normalized.platformUserId);
  if (existing) {
    if (existing.orgId !== normalized.orgId) {
      throw new PlatformAccountConflictError(normalized.platform, normalized.platformUserId, {
        kind: "org",
        id: existing.id,
      });
    }
    const { orgId: _orgId, platform: _platform, platformUserId: _platformUserId, ...rest } =
      normalized;
    return updateOrgIdentity(existing.id, rest)!;
  }

  const { id: _id, ...createData } = normalized;
  return createOrgIdentity(createData);
}
