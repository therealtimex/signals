import { z } from "zod";
import type { Variant } from "@/lib/db/types";
import { writingUnitsSchema } from "@/lib/writing/content-writing";
import {
  variantPersonalitySnapshotSchema,
  writingAuditPersonalitySchema,
} from "@/lib/writing/personality-lineage";

const variantWritingProjectionSchema = z
  .object({
    audit: z
      .object({
        id: z.string().min(1),
        inputHash: z.string().min(1),
        verdict: z.string().min(1),
        personality: writingAuditPersonalitySchema.nullable().optional(),
      })
      .passthrough()
      .nullable(),
    approval: z
      .object({
        state: z.enum(["pending", "approved", "rejected", "revoked"]),
        at: z.number().int().nonnegative().optional(),
        by: z.string().min(1).optional(),
        auditId: z.string().min(1).optional(),
        riskTier: z.enum(["low", "medium", "high"]).optional(),
      })
      .passthrough()
      .nullable(),
    units: writingUnitsSchema.optional(),
    targetId: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    surface: z.string().min(1).optional(),
    schemaVersion: z.literal(1).optional(),
    spine: z.object({ id: z.string().min(1), hash: z.string().min(1) }).passthrough().optional(),
    materializedContentItemId: z.string().min(1).optional(),
    personality: variantPersonalitySnapshotSchema.nullable().optional(),
    lineage: z.object({
      derivedFromVariantId: z.string().optional(),
      adaptedFromContentItemId: z.string().optional(),
      adaptedFromVariantId: z.string().optional(),
      sourceIds: z.array(z.string()),
    }).passthrough().optional(),
  })
  .passthrough();

export type VariantWritingProjection = z.infer<typeof variantWritingProjectionSchema>;

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseMetadata(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readVariantWritingProjection(
  variant: Pick<Variant, "metadata"> | { metadata?: unknown },
): VariantWritingProjection | null {
  const parsed = variantWritingProjectionSchema.safeParse(parseMetadata(variant.metadata).writing);
  return parsed.success ? parsed.data : null;
}
