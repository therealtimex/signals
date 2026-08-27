import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PERSONA_GENERATION_MODE,
  getStoredPersonaGenerationMode,
  PERSONA_GENERATION_MODE_ENV,
  registerPersonaAgentJobBackend,
  resetPersonaAgentJobBackendForTests,
  resetPersonaGenerationModeForTests,
  resolvePersonaGenerationMode,
  setStoredPersonaGenerationMode,
} from "@/lib/settings/persona-generation-mode";

describe("persona-generation-mode", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SIGNALS_DATA_DIR = mkdtempSync(join(tmpdir(), "signals-persona-mode-"));
    delete process.env[PERSONA_GENERATION_MODE_ENV];
    delete process.env.RTX_APP_ID;
    resetPersonaGenerationModeForTests();
    resetPersonaAgentJobBackendForTests();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("defaults to structured workflow", () => {
    const resolution = resolvePersonaGenerationMode();
    expect(resolution.requestedMode).toBe(DEFAULT_PERSONA_GENERATION_MODE);
    expect(resolution.effectiveMode).toBe("structured_workflow");
    expect(resolution.source).toBe("default");
  });

  it("prefers env override over stored config", () => {
    setStoredPersonaGenerationMode("structured_workflow");
    process.env[PERSONA_GENERATION_MODE_ENV] = "terminal_agent";
    process.env.RTX_APP_ID = "app-1";
    registerPersonaAgentJobBackend();

    const resolution = resolvePersonaGenerationMode();
    expect(resolution.requestedMode).toBe("terminal_agent");
    expect(resolution.effectiveMode).toBe("terminal_agent");
    expect(resolution.source).toBe("env");
  });

  it("derives structured workflow when terminal agent is unavailable in standalone mode", () => {
    setStoredPersonaGenerationMode("terminal_agent");

    const resolution = resolvePersonaGenerationMode();
    expect(resolution.requestedMode).toBe("terminal_agent");
    expect(resolution.effectiveMode).toBe("structured_workflow");
    expect(resolution.options.find((option) => option.value === "terminal_agent")).toMatchObject({
      available: false,
      unavailableReason: "standalone",
    });
  });

  it("marks terminal agent unavailable until backend registration", () => {
    process.env.RTX_APP_ID = "app-1";
    setStoredPersonaGenerationMode("terminal_agent");

    const resolution = resolvePersonaGenerationMode();
    expect(resolution.effectiveMode).toBe("structured_workflow");
    expect(resolution.options.find((option) => option.value === "terminal_agent")).toMatchObject({
      available: false,
      unavailableReason: "backend_unavailable",
    });
  });

  it("clears stored mode when reset to null", () => {
    setStoredPersonaGenerationMode("terminal_agent");
    expect(getStoredPersonaGenerationMode()).toBe("terminal_agent");

    setStoredPersonaGenerationMode(null);
    expect(getStoredPersonaGenerationMode()).toBeNull();
    expect(resolvePersonaGenerationMode().source).toBe("default");
  });
});
