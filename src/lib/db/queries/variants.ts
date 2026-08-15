import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { variants } from "@/lib/db/schema";
import { assertPlatform } from "@/lib/db/platforms";
import { assertVariantType } from "@/lib/db/variant-types";
import { createContentItem } from "@/lib/db/queries/content";
import { getLaunchById } from "@/lib/db/queries/launches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import type { Variant } from "@/lib/db/types";

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
      label: input.label ?? existing.label,
      variantType,
      body: input.body ?? existing.body,
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

export function upsertVariant(input: UpsertVariantInput): Variant {
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

/** Sole writer of `published_as` edges and `variants.status = 'published'`. */
export function publishVariant(
  variantId: string,
  opts?: {
    platform?: string;
    publishedAt?: number;
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
    properties: JSON.stringify({ platform, published_at: publishedAt }),
    scope: launch.scope,
    source: "agent",
  });

  db.update(variants)
    .set({ status: "published", updatedAt: now })
    .where(eq(variants.id, variantId))
    .run();

  return getVariantById(variantId)!;
}

/** Hook for `/api/content/publish` — link an already-published content item back to its variant. */
export function publishVariantForContentItem(
  contentItemId: string,
  opts: { platform: string; publishedAt?: number },
): Variant | null {
  const variant = getVariantByContentItemId(contentItemId);
  if (!variant) return null;

  return publishVariant(variant.id, {
    platform: opts.platform,
    publishedAt: opts.publishedAt,
    materializeAsPublished: false,
  });
}
