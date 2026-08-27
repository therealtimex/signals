import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import { readSignalsConfig, updateSignalsConfig } from "@/lib/settings/signals-config";

export const PERSONA_GENERATION_MODES = ["structured_workflow", "terminal_agent"] as const;
export type PersonaGenerationMode = (typeof PERSONA_GENERATION_MODES)[number];
export const DEFAULT_PERSONA_GENERATION_MODE: PersonaGenerationMode = "structured_workflow";
export const PERSONA_GENERATION_MODE_ENV = "SIGNALS_PERSONA_GENERATION_MODE";

export type PersonaModeUnavailableReason = "standalone" | "backend_unavailable";
export type PersonaModeResolution = {
  storedMode: PersonaGenerationMode | null;
  requestedMode: PersonaGenerationMode;
  effectiveMode: PersonaGenerationMode;
  source: "env" | "config" | "default";
  embedded: boolean;
  options: Array<{
    value: PersonaGenerationMode;
    available: boolean;
    unavailableReason?: PersonaModeUnavailableReason;
  }>;
};

let personaAgentJobBackendRegistered = false;
let warnedInvalidEnvMode = false;

export function registerPersonaAgentJobBackend(): void {
  personaAgentJobBackendRegistered = true;
}

export function resetPersonaAgentJobBackendForTests(): void {
  personaAgentJobBackendRegistered = false;
}

export function isPersonaAgentJobBackendAvailable(): boolean {
  return personaAgentJobBackendRegistered;
}

function parseMode(value: string | undefined): PersonaGenerationMode | null {
  if (!value) return null;
  const normalized = value.trim();
  if ((PERSONA_GENERATION_MODES as readonly string[]).includes(normalized)) {
    return normalized as PersonaGenerationMode;
  }
  if (!warnedInvalidEnvMode) {
    console.warn(
      `[signals] Ignoring invalid ${PERSONA_GENERATION_MODE_ENV}="${value}"; expected structured_workflow or terminal_agent.`,
    );
    warnedInvalidEnvMode = true;
  }
  return null;
}

export function getStoredPersonaGenerationMode(): PersonaGenerationMode | null {
  const mode = readSignalsConfig().personaGenerationMode;
  return mode && (PERSONA_GENERATION_MODES as readonly string[]).includes(mode)
    ? mode
    : null;
}

export function setStoredPersonaGenerationMode(mode: PersonaGenerationMode | null): void {
  if (mode) {
    updateSignalsConfig({ personaGenerationMode: mode });
    return;
  }
  updateSignalsConfig({ personaGenerationMode: undefined });
}

export function resetPersonaGenerationModeForTests(): void {
  setStoredPersonaGenerationMode(null);
  warnedInvalidEnvMode = false;
}

function resolveTerminalAgentAvailability(
  embedded: boolean,
): { available: boolean; unavailableReason?: PersonaModeUnavailableReason } {
  if (!embedded) {
    return { available: false, unavailableReason: "standalone" };
  }
  if (!isPersonaAgentJobBackendAvailable()) {
    return { available: false, unavailableReason: "backend_unavailable" };
  }
  return { available: true };
}

export function resolvePersonaGenerationMode(env: EnvLike = process.env): PersonaModeResolution {
  const embedded = isRtxEmbedded(env);
  const envMode = parseMode(env[PERSONA_GENERATION_MODE_ENV]);
  const storedMode = getStoredPersonaGenerationMode();
  const requestedMode = envMode ?? storedMode ?? DEFAULT_PERSONA_GENERATION_MODE;
  const source: PersonaModeResolution["source"] = envMode
    ? "env"
    : storedMode
      ? "config"
      : "default";

  const terminalAgent = resolveTerminalAgentAvailability(embedded);
  const options: PersonaModeResolution["options"] = [
    {
      value: "terminal_agent",
      available: terminalAgent.available,
      unavailableReason: terminalAgent.unavailableReason,
    },
    { value: "structured_workflow", available: true },
  ];

  let effectiveMode = requestedMode;
  if (requestedMode === "terminal_agent" && !terminalAgent.available) {
    effectiveMode = "structured_workflow";
  }

  return {
    storedMode,
    requestedMode,
    effectiveMode,
    source,
    embedded,
    options,
  };
}

export function isPersonaGenerationModeEnvLocked(env: EnvLike = process.env): boolean {
  return Boolean(parseMode(env[PERSONA_GENERATION_MODE_ENV]));
}
