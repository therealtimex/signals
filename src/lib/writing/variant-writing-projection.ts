import { z } from "zod";
import type { Variant } from "@/lib/db/types";
import { writingUnitsSchema } from "@/lib/writing/content-writing";

const variantWritingProjectionSchema = z
  .object({
    audit: z
      .object({
        id: z.string().min(1),
        inputHash: z.string().min(1),
        verdict: z.string().min(1),
      })
      .passthrough()
      .nullable(),
    approval: z
      .object({
        state: z.string().min(1),
        at: z.number().int().nonnegative(),
        by: z.string().min(1),
        auditId: z.string().min(1),
      })
      .passthrough()
      .nullable(),
    units: writingUnitsSchema.optional(),
    targetId: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    surface: z.string().min(1).optional(),
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
