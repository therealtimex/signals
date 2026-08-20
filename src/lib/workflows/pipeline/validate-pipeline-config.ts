import { z } from "zod";
import type { PipelineConfig, PipelineStepDecl } from "@/lib/workflows/pipeline/types";
import { PIPELINE_STEP_HANDLER_KEYS } from "@/lib/workflows/pipeline/handlers/index";

const profilePipelineFiltersSchema = z.object({
  platform: z.string().optional(),
  maxEnrichmentScore: z.number().optional(),
  needsAvatar: z.boolean().optional(),
  needsPersona: z.boolean().optional(),
  personaStale: z.boolean().optional(),
});

export const profilePipelineRunInputSchema = z.object({
  batchSize: z.number().int().positive().optional(),
  contactIds: z.array(z.string().min(1)).optional(),
  filters: profilePipelineFiltersSchema.optional(),
  forcePersona: z.boolean().optional(),
  scheduleDrain: z.boolean().optional(),
});

export type ProfilePipelineRunInputParsed = z.infer<typeof profilePipelineRunInputSchema>;

const pipelineStepSchema = z.object({
  id: z.string().min(1),
  executor: z.enum(["code", "llm", "agent"]),
  handler: z.string().min(1),
  options: z.record(z.unknown()).optional(),
});

const pipelineConfigSchema = z.object({
  version: z.number().int().positive(),
  planner: z.string().min(1),
  batchSize: z.number().int().positive().optional(),
  filters: profilePipelineFiltersSchema.optional(),
  scheduleDrain: z.boolean().optional(),
  steps: z.array(pipelineStepSchema).min(1),
});

export type PipelineConfigValidationResult =
  | { success: true; pipeline: PipelineConfig }
  | { success: false; errorCode: "PIPELINE_STEP_UNSUPPORTED"; message: string };

export function validatePipelineConfig(
  raw: unknown,
): PipelineConfigValidationResult {
  const parsed = pipelineConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      errorCode: "PIPELINE_STEP_UNSUPPORTED",
      message: "Invalid pipeline configuration",
    };
  }

  for (const step of parsed.data.steps) {
    const stepError = validatePipelineStepDecl(step);
    if (stepError) return stepError;
  }

  return { success: true, pipeline: parsed.data };
}

function validatePipelineStepDecl(
  step: PipelineStepDecl,
): Extract<PipelineConfigValidationResult, { success: false }> | null {
  if (step.executor === "agent") {
    return {
      success: false,
      errorCode: "PIPELINE_STEP_UNSUPPORTED",
      message: `Pipeline step "${step.id}" uses unsupported executor "agent"`,
    };
  }

  if (!PIPELINE_STEP_HANDLER_KEYS.includes(step.handler)) {
    return {
      success: false,
      errorCode: "PIPELINE_STEP_UNSUPPORTED",
      message: `Unknown pipeline handler "${step.handler}" for step "${step.id}"`,
    };
  }

  return null;
}

export function parsePipelineFromTemplateConfig(
  config: string | null | undefined,
): PipelineConfig | null {
  if (!config?.trim()) return null;
  try {
    const parsed = JSON.parse(config) as { pipeline?: unknown };
    if (!parsed.pipeline) return null;
    const validated = validatePipelineConfig(parsed.pipeline);
    return validated.success ? validated.pipeline : null;
  } catch {
    return null;
  }
}

export function isPipelineTemplate(config: string | null | undefined): boolean {
  return parsePipelineFromTemplateConfig(config) != null;
}

export function getValidatedPipelineFromTemplate(
  config: string | null | undefined,
): PipelineConfigValidationResult {
  if (!config?.trim()) {
    return {
      success: false,
      errorCode: "PIPELINE_STEP_UNSUPPORTED",
      message: "Template has no pipeline configuration",
    };
  }

  try {
    const parsed = JSON.parse(config) as { pipeline?: unknown };
    if (!parsed.pipeline) {
      return {
        success: false,
        errorCode: "PIPELINE_STEP_UNSUPPORTED",
        message: "Template has no pipeline configuration",
      };
    }
    return validatePipelineConfig(parsed.pipeline);
  } catch {
    return {
      success: false,
      errorCode: "PIPELINE_STEP_UNSUPPORTED",
      message: "Invalid template configuration JSON",
    };
  }
}
