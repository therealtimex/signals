import type { PipelineStepHandler } from "@/lib/workflows/pipeline/types";
import { enrichContactAvatars } from "@/lib/workflows/pipeline/handlers/enrich-contact-avatars";
import { generatePersonaStepHandler } from "@/lib/workflows/pipeline/handlers/generate-persona-step";
import { hydrateXProfiles } from "@/lib/workflows/pipeline/handlers/hydrate-x-profiles";

export const PIPELINE_STEP_HANDLERS: Record<string, PipelineStepHandler> = {
  hydrate_x_profiles: hydrateXProfiles,
  enrich_contact_avatars: enrichContactAvatars,
  generate_persona: generatePersonaStepHandler,
};

export const PIPELINE_STEP_HANDLER_KEYS = Object.keys(PIPELINE_STEP_HANDLERS);
