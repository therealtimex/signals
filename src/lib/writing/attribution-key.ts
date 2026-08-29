import type { ContentItem, ContentPost, Variant } from "@/lib/db/types";
import { getLaunchById } from "@/lib/db/queries/launches";
import { type VariantWriting, variantWritingSchema } from "@/lib/writing/contracts";

export type AttributionKey = {
  platform: string;
  surface: string;
  goal: string;
  formulaId: string;
  overlayVersion: number;
  coreVersion: number;
  voiceProfileId: string | null;
  voiceProfileVersion: number | null;
  audienceCohort: string;
  launchId: string;
  variantId: string;
  contentItemId: string;
  contentPostId: string;
  targetId?: string;
};

export function deriveAttributionKey(input: {
  writing: VariantWriting;
  nicheIds: string[];
  launchId: string;
  variantId: string;
  contentItemId: string;
  contentPostId: string;
}): AttributionKey {
  return {
    platform: input.writing.platform,
    surface: input.writing.surface,
    goal: input.writing.goal,
    formulaId: input.writing.formulaId,
    overlayVersion: input.writing.overlay.version,
    coreVersion: input.writing.core.version,
    voiceProfileId: input.writing.voiceProfile?.id ?? null,
    voiceProfileVersion: input.writing.voiceProfile?.version ?? null,
    audienceCohort: [...new Set(input.nicheIds)].sort().join("+") || "unspecified",
    launchId: input.launchId,
    variantId: input.variantId,
    contentItemId: input.contentItemId,
    contentPostId: input.contentPostId,
    ...(input.writing.targetId ? { targetId: input.writing.targetId } : {}),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildAttributionKey(
  variant: Variant,
  contentItem: ContentItem,
  contentPost: ContentPost,
): AttributionKey {
  const writing = variantWritingSchema.parse(object(variant.metadata).writing);
  if (variant.contentItemId !== contentItem.id || contentPost.contentItemId !== contentItem.id) {
    throw new Error("Attribution records must share the same variant-to-content lineage");
  }
  const launch = getLaunchById(variant.launchId);
  if (!launch) throw new Error(`Launch not found: ${variant.launchId}`);
  const audience = object(launch.audienceSpec);
  const nicheIds = Array.isArray(audience.nicheIds)
    ? audience.nicheIds.filter((value): value is string => typeof value === "string")
    : [];
  return deriveAttributionKey({
    writing,
    nicheIds,
    launchId: launch.id,
    variantId: variant.id,
    contentItemId: contentItem.id,
    contentPostId: contentPost.id,
  });
}
