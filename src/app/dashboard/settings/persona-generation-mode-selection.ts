import type { PersonaGenerationMode, PersonaModeResolution } from "@/lib/settings/persona-generation-mode";

export function resolvePersonaModeCardSelection(
  resolution: PersonaModeResolution,
): PersonaGenerationMode {
  if (resolution.source === "env") {
    return resolution.requestedMode;
  }
  return resolution.storedMode ?? resolution.requestedMode ?? "structured_workflow";
}
