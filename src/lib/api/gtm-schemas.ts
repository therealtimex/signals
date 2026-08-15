import { z } from "zod";
import { PLATFORMS } from "@/lib/db/platforms";
import { VARIANT_TYPES } from "@/lib/db/variant-types";

const launchStatusEnum = z.enum([
  "draft",
  "generating",
  "simulating",
  "ready",
  "live",
  "completed",
  "archived",
]);

const variantWriteStatusEnum = z.enum(["draft", "simulated", "selected", "rejected"]);

const simulationStatusEnum = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const createLaunchSchema = z.object({
  name: z.string().min(1),
  brief: z.string().nullable().optional(),
  status: launchStatusEnum.optional(),
  primaryPlatform: z.enum(PLATFORMS).nullable().optional(),
  audienceSpec: z.record(z.unknown()).optional(),
  workflowTemplateId: z.string().nullable().optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  metadata: z.record(z.unknown()).optional(),
  launchedAt: z.number().int().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
});

export const updateLaunchSchema = createLaunchSchema;

export const createVariantSchema = z.object({
  label: z.string().nullable().optional(),
  variantType: z.enum(VARIANT_TYPES).optional(),
  body: z.string().nullable().optional(),
  status: variantWriteStatusEnum.optional(),
});

export const updateVariantSchema = z
  .object({
    label: z.string().nullable().optional(),
    variantType: z.enum(VARIANT_TYPES).optional(),
    body: z.string().nullable().optional(),
    status: z
      .enum(["draft", "simulated", "selected", "rejected", "published"])
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (input.status === "published") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "status published is not allowed via REST — use agent-tools or content publish",
        path: ["status"],
      });
    }
  });

export const simulationListQuerySchema = z.object({
  variantId: z.string().optional(),
  launchId: z.string().optional(),
  batchId: z.string().optional(),
  status: simulationStatusEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const launchListQuerySchema = z.object({
  search: z.string().optional(),
  status: launchStatusEnum.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  includeLocalOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const simulationDetailQuerySchema = z.object({
  includeAgents: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  includeTranscripts: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  includeCalibration: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
