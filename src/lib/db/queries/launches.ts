import { and, count, desc, eq, like, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { assertPlatform } from "@/lib/db/platforms";
import { launches, variants } from "@/lib/db/schema";
import { getNeighbors } from "@/lib/db/queries/graph";
import { listVariantsByLaunchId } from "@/lib/db/queries/variants";
import type { Launch, PaginatedResult } from "@/lib/db/types";

export type LaunchVariantSummary = {
  id: string;
  label: string | null;
  status: string;
  predictedScore: number | null;
};

export type LaunchWithDetails = Launch & {
  variants: LaunchVariantSummary[];
  goalIds: string[];
};

export function listLaunches(opts?: {
  search?: string;
  status?: Launch["status"];
  page?: number;
  pageSize?: number;
  includeLocalOnly?: boolean;
}): PaginatedResult<LaunchWithDetails> {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 20;
  const conditions: SQL[] = [];

  if (!opts?.includeLocalOnly) {
    conditions.push(eq(launches.scope, "shared"));
  }
  if (opts?.status) {
    conditions.push(eq(launches.status, opts.status));
  }
  if (opts?.search) {
    conditions.push(like(launches.name, `%${opts.search}%`));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const total = db.select({ value: count() }).from(launches).where(where).get()?.value ?? 0;

  const rows = db
    .select()
    .from(launches)
    .where(where)
    .orderBy(desc(launches.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const data = rows.map((launch) => ({
    ...launch,
    variants: summarizeVariants(launch.id),
    goalIds: getLaunchGoalIds(launch.id, opts?.includeLocalOnly),
  }));

  return { data, total };
}

export function getLaunchById(id: string): Launch | undefined {
  return db.select().from(launches).where(eq(launches.id, id)).get();
}

export function getLaunchWithDetails(
  id: string,
  opts?: { includeLocalOnly?: boolean },
): LaunchWithDetails | undefined {
  const launch = getLaunchById(id);
  if (!launch) return undefined;
  return {
    ...launch,
    variants: summarizeVariants(id),
    goalIds: getLaunchGoalIds(id, opts?.includeLocalOnly),
  };
}

function summarizeVariants(launchId: string): LaunchVariantSummary[] {
  return listVariantsByLaunchId(launchId).map((variant) => ({
    id: variant.id,
    label: variant.label,
    status: variant.status,
    predictedScore: variant.predictedScore,
  }));
}

function getLaunchGoalIds(launchId: string, includeLocalOnly?: boolean): string[] {
  return getNeighbors("launch", launchId, {
    edgeTypes: ["contributes_to"],
    direction: "outgoing",
    includeLocalOnly,
  })
    .filter((edge) => edge.dstType === "goal")
    .map((edge) => edge.dstId);
}

export type UpsertLaunchInput = {
  id?: string;
  name: string;
  brief?: string | null;
  status?: Launch["status"];
  primaryPlatform?: string | null;
  audienceSpec?: Record<string, unknown>;
  workflowTemplateId?: string | null;
  scope?: Launch["scope"];
  metadata?: Record<string, unknown>;
  launchedAt?: number | null;
  completedAt?: number | null;
};

function normalizePrimaryPlatform(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return assertPlatform(value);
}

export function upsertLaunch(input: UpsertLaunchInput): Launch {
  const now = Math.floor(Date.now() / 1000);

  if (input.id) {
    const existing = getLaunchById(input.id);
    if (!existing) {
      throw new Error(`Launch not found: ${input.id}`);
    }

    db.update(launches)
      .set({
        name: input.name.trim(),
        brief: input.brief !== undefined ? input.brief : existing.brief,
        status: input.status ?? existing.status,
        primaryPlatform:
          input.primaryPlatform !== undefined
            ? normalizePrimaryPlatform(input.primaryPlatform)
            : existing.primaryPlatform,
        audienceSpec: input.audienceSpec
          ? JSON.stringify(input.audienceSpec)
          : existing.audienceSpec,
        workflowTemplateId:
          input.workflowTemplateId !== undefined
            ? input.workflowTemplateId
            : existing.workflowTemplateId,
        scope: input.scope ?? existing.scope,
        metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata,
        launchedAt: input.launchedAt !== undefined ? input.launchedAt : existing.launchedAt,
        completedAt:
          input.completedAt !== undefined ? input.completedAt : existing.completedAt,
        updatedAt: now,
      })
      .where(eq(launches.id, input.id))
      .run();

    return getLaunchById(input.id)!;
  }

  const id = nanoid();
  db.insert(launches)
    .values({
      id,
      name: input.name.trim(),
      brief: input.brief ?? null,
      status: input.status ?? "draft",
      primaryPlatform: normalizePrimaryPlatform(input.primaryPlatform) ?? null,
      audienceSpec: JSON.stringify(input.audienceSpec ?? {}),
      workflowTemplateId: input.workflowTemplateId ?? null,
      scope: input.scope ?? "shared",
      source: "agent",
      metadata: JSON.stringify(input.metadata ?? {}),
      launchedAt: input.launchedAt ?? null,
      completedAt: input.completedAt ?? null,
    })
    .run();

  return getLaunchById(id)!;
}
