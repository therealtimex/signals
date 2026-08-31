import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, type DbRunner } from "@/lib/db/client";
import { launches, variants } from "@/lib/db/schema";
import { assertPlatform } from "@/lib/db/platforms";
import { assertVariantType } from "@/lib/db/variant-types";
import { createContentItem } from "@/lib/db/queries/content";
import { getLaunchById } from "@/lib/db/queries/launches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import type { Variant } from "@/lib/db/types";
import {
  isWritingVariant,
  persistWritingVariant,
  type PersistPersonalityContext,
} from "@/lib/writing/variant-writing";
import type { LineageEdgeSummary } from "@/lib/writing/lineage";

export { isWritingVariant } from "@/lib/writing/variant-writing";

export function listVariantsByLaunchId(launchId: string): Variant[] {
  return db
    .select()
    .from(variants)
    .where(eq(variants.launchId, launchId))
    .orderBy(desc(variants.updatedAt))
    .all();
}

export function getVariantById(id: string): Variant | undefined {
  return db.select().from(variants).where(eq(variants.id, id)).get();
}

export function getVariantByContentItemId(contentItemId: string): Variant | undefined {
  return db.select().from(variants).where(eq(variants.contentItemId, contentItemId)).get();
}

export function updateWritingVariantLabel(id: string, label: string | null): Variant {
  const variant = getVariantById(id);
  if (!variant) throw new Error(`Variant not found: ${id}`);
  db.update(variants).set({ label, updatedAt: Math.floor(Date.now() / 1000) }).where(eq(variants.id, id)).run();
  return getVariantById(id)!;
}

export type UpsertVariantInput = {
  id?: string;
  launchId: string;
  label?: string | null;
  variantType?: string;
  body?: string | null;
  contentItemId?: string | null;
  status?: Variant["status"];
  predictedScore?: number | null;
  predictionConfidence?: number | null;
  predictedMetrics?: Record<string, unknown>;
  predictionModel?: string | null;
  simulatedAt?: number | null;
  generationModel?: string | null;
  generationMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  platform?: string;
  publishedAt?: number;
};

function resolvePublishPlatform(
  callPlatform: string | undefined,
  launchPrimaryPlatform: string | null,
): string {
  const resolved = callPlatform ?? launchPrimaryPlatform ?? undefined;
  if (!resolved) {
    throw new Error("Publish requires platform on the variant call or launch.primaryPlatform");
  }
  return assertPlatform(resolved);
}

function applyVariantUpdate(
  existing: Variant,
  input: UpsertVariantInput,
  variantType: string,
  now: number,
  status: Variant["status"],
): void {
  db.update(variants)
    .set({
      launchId: input.launchId,
      label: input.label !== undefined ? input.label : existing.label,
      variantType,
      body: input.body !== undefined ? input.body : existing.body,
      contentItemId: input.contentItemId ?? existing.contentItemId,
      status,
      predictedScore: input.predictedScore ?? existing.predictedScore,
      predictionConfidence: input.predictionConfidence ?? existing.predictionConfidence,
      predictedMetrics: input.predictedMetrics
        ? JSON.stringify(input.predictedMetrics)
        : existing.predictedMetrics,
      predictionModel: input.predictionModel ?? existing.predictionModel,
      simulatedAt: input.simulatedAt ?? existing.simulatedAt,
      generationModel: input.generationModel ?? existing.generationModel,
      generationMetadata: input.generationMetadata
        ? JSON.stringify(input.generationMetadata)
        : existing.generationMetadata,
      metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata,
      updatedAt: now,
    })
    .where(eq(variants.id, existing.id))
    .run();
}

export type UpsertVariantResult = Variant & {
  writing?: boolean;
  created?: boolean;
  lineageEdges?: LineageEdgeSummary[];
};

export function upsertVariant(
  input: UpsertVariantInput,
  writingRunner?: DbRunner,
): UpsertVariantResult {
  const existingForKind = input.id
    ? writingRunner
      ? writingRunner.select().from(variants).where(eq(variants.id, input.id)).get()
      : getVariantById(input.id)
    : undefined;
  if (input.generationMetadata?.kind === "signals-writing" || isWritingVariant(existingForKind)) {
    const result = writingRunner
      ? persistWritingVariant(input, undefined, writingRunner)
      : db.transaction((tx) => persistWritingVariant(input, undefined, tx));
    return {
      ...result.variant,
      writing: true,
      created: result.created,
      lineageEdges: result.lineageEdges,
    };
  }
  if (!getLaunchById(input.launchId)) {
    throw new Error(`Launch not found: ${input.launchId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const wantsPublish = input.status === "published";

  if (input.id) {
    const existing = getVariantById(input.id);
    if (!existing) {
      throw new Error(`Variant not found: ${input.id}`);
    }

    const variantType = input.variantType
      ? assertVariantType(input.variantType)
      : existing.variantType;

    applyVariantUpdate(
      existing,
      input,
      variantType,
      now,
      wantsPublish ? existing.status : (input.status ?? existing.status),
    );

    if (wantsPublish) {
      return publishVariant(input.id, {
        platform: input.platform,
        publishedAt: input.publishedAt,
        materializeAsPublished: true,
      });
    }

    return getVariantById(input.id)!;
  }

  const variantType = input.variantType ? assertVariantType(input.variantType) : "post";
  const id = nanoid();
  db.insert(variants)
    .values({
      id,
      launchId: input.launchId,
      label: input.label ?? null,
      variantType,
      body: input.body ?? null,
      contentItemId: input.contentItemId ?? null,
      status: wantsPublish ? "draft" : (input.status ?? "draft"),
      predictedScore: input.predictedScore ?? null,
      predictionConfidence: input.predictionConfidence ?? null,
      predictedMetrics: JSON.stringify(input.predictedMetrics ?? {}),
      predictionModel: input.predictionModel ?? null,
      simulatedAt: input.simulatedAt ?? null,
      generationModel: input.generationModel ?? null,
      generationMetadata: JSON.stringify(input.generationMetadata ?? {}),
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .run();

  if (wantsPublish) {
    return publishVariant(id, {
      platform: input.platform,
      publishedAt: input.publishedAt,
      materializeAsPublished: true,
    });
  }

  return getVariantById(id)!;
}

export function upsertPersonalityBoundWritingVariant(
  input: UpsertVariantInput,
  personality: PersistPersonalityContext,
  runner: DbRunner,
): UpsertVariantResult {
  const result = persistWritingVariant(input, personality, runner);
  return {
    ...result.variant,
    writing: true,
    created: result.created,
    lineageEdges: result.lineageEdges,
  };
}

/** Sole writer of `published_as` edges and `variants.status = 'published'`. */
export function publishVariant(
  variantId: string,
  opts?: {
    platform?: string;
    publishedAt?: number;
    targetId?: string;
    materializeAsPublished?: boolean;
  },
): Variant {
  const variant = getVariantById(variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }

  const launch = getLaunchById(variant.launchId);
  if (!launch) {
    throw new Error(`Launch not found: ${variant.launchId}`);
  }

  const platform = resolvePublishPlatform(opts?.platform, launch.primaryPlatform);
  const publishedAt = opts?.publishedAt ?? Math.floor(Date.now() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const writing = isWritingVariant(variant);
  let contentItemId = variant.contentItemId;

  if (!contentItemId) {
    const contentItem = createContentItem({
      body: variant.body,
      contentType: variant.variantType === "thread" ? "thread" : "post",
      platformTarget: platform,
      status: opts?.materializeAsPublished === false ? "approved" : "published",
      aiGenerated: true,
      origin: "authored",
      direction: "outbound",
    });
    contentItemId = contentItem.id;
    db.update(variants)
      .set({ contentItemId, updatedAt: now })
      .where(eq(variants.id, variantId))
      .run();
  }

  upsertGraphEdge({
    srcType: "variant",
    srcId: variantId,
    dstType: "content",
    dstId: contentItemId,
    edgeType: "published_as",
    properties: JSON.stringify({
      platform,
      published_at: publishedAt,
      ...(opts?.targetId ? { targetId: opts.targetId } : {}),
    }),
    scope: launch.scope,
    source: writing ? "signals-writing" : "agent",
  });

  db.update(variants)
    .set({ status: "published", updatedAt: now })
    .where(eq(variants.id, variantId))
    .run();

  if (writing && ["generating", "ready", "simulating"].includes(launch.status)) {
    db.update(launches)
      .set({ status: "live", launchedAt: launch.launchedAt ?? publishedAt, updatedAt: now })
      .where(eq(launches.id, launch.id))
      .run();
  }

  return getVariantById(variantId)!;
}

/** Hook for `/api/content/publish` — link an already-published content item back to its variant. */
export function publishVariantForContentItem(
  contentItemId: string,
  opts: { platform: string; publishedAt?: number; targetId?: string },
): Variant | null {
  const variant = getVariantByContentItemId(contentItemId);
  if (!variant) return null;

  return publishVariant(variant.id, {
    platform: opts.platform,
    publishedAt: opts.publishedAt,
    targetId: opts.targetId,
    materializeAsPublished: false,
  });
}
