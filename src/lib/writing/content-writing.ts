import { z } from "zod";
import type { ContentItem } from "@/lib/db/types";
import { PLATFORMS } from "@/lib/db/platforms";
import { SURFACE_IDS } from "@/lib/writing/surfaces";
import { variantPersonalitySnapshotSchema } from "@/lib/writing/personality-lineage";

export const CONTENT_WRITING_KEY = "writing";

export const writingUnitsSchema = z
  .object({
    texts: z.array(z.string()).min(1),
    count: z.number().int().positive(),
    chars: z.array(z.number().int().nonnegative()).min(1),
  })
  .superRefine((units, ctx) => {
    if (units.count !== units.texts.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "count must match texts" });
    }
    if (units.chars.length !== units.texts.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chars"], message: "chars must match texts" });
    }
    if (units.chars.some((chars, index) => chars !== units.texts[index].length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chars"],
        message: "each chars entry must match its text length",
      });
    }
  });

export type WritingUnits = z.infer<typeof writingUnitsSchema>;

export const materializationSnapshotSchema = z.object({
  auditId: z.string().min(1),
  inputHash: z.string().min(1),
  approvalAt: z.number().int().nonnegative(),
  approvalBy: z.string().min(1),
});

export const contentWritingSchema = z
  .object({
    schemaVersion: z.literal(1),
    idempotencyKey: z.string().min(1).max(200).optional(),
    surface: z.enum(SURFACE_IDS).nullable().optional(),
    capability: z.object({
      publish: z.enum(["direct", "beta", "draft_only", "export_only", "unsupported"]),
    }),
    units: writingUnitsSchema,
    origin: z
      .object({
        launchId: z.string().min(1).optional(),
        variantId: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    launchId: z.string().min(1).optional(),
    variantId: z.string().min(1).optional(),
    targetId: z.string().min(1).optional(),
    platform: z.enum(PLATFORMS).optional(),
    materialization: materializationSnapshotSchema.optional(),
    personality: variantPersonalitySnapshotSchema.nullable().optional(),
  })
  .passthrough();

export type ContentWritingMetadata = z.infer<typeof contentWritingSchema>;

export type ContentWritingReadState =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid"; writing: ContentWritingMetadata };

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readContentWriting(
  item: Pick<ContentItem, "platformData"> | { platformData?: unknown },
): ContentWritingMetadata | null {
  const state = readContentWritingState(item);
  return state.kind === "valid" ? state.writing : null;
}

export function readContentWritingState(
  item: Pick<ContentItem, "platformData"> | { platformData?: unknown },
): ContentWritingReadState {
  const root = parseObject(item.platformData);
  if (!Object.prototype.hasOwnProperty.call(root, CONTENT_WRITING_KEY)) {
    return { kind: "absent" };
  }
  const parsed = contentWritingSchema.safeParse(root[CONTENT_WRITING_KEY]);
  return parsed.success
    ? { kind: "valid", writing: parsed.data }
    : { kind: "invalid" };
}

export function mergeContentWriting(
  platformData: unknown,
  patch: Partial<ContentWritingMetadata>,
): string {
  const root = parseObject(platformData);
  const existing = parseObject(root[CONTENT_WRITING_KEY]);
  const merged = contentWritingSchema.parse({ ...existing, ...patch });
  return JSON.stringify({ ...root, [CONTENT_WRITING_KEY]: merged });
}

export function buildWritingUnits(texts: string[]): WritingUnits {
  return writingUnitsSchema.parse({
    texts,
    count: texts.length,
    chars: texts.map((text) => text.length),
  });
}

export function deriveWritingPublishText(
  writing: ContentWritingMetadata,
  item: Pick<ContentItem, "contentType" | "platformTarget">,
): { text: string; threadTexts?: string[] } {
  const [text, ...continuations] = writing.units.texts;
  return {
    text,
    ...(item.platformTarget === "x" && item.contentType === "thread" && continuations.length > 0
      ? { threadTexts: continuations }
      : {}),
  };
}
