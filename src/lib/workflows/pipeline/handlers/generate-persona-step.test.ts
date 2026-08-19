import { describe, expect, it, vi } from "vitest";
import { PersonaGenerationUnavailableError } from "@/lib/db/queries/persona-errors";
import { generatePersonaStepHandler } from "@/lib/workflows/pipeline/handlers/generate-persona-step";

vi.mock("@/lib/workflows/generate-persona", () => ({
  generatePersona: vi.fn(),
}));

vi.mock("@/lib/workflows/refresh-persona-if-stale", () => ({
  refreshPersonaIfStale: vi.fn(),
}));

vi.mock("@/lib/db/queries/personas", () => ({
  getActivePersona: vi.fn(),
}));

import { generatePersona } from "@/lib/workflows/generate-persona";
import { getActivePersona } from "@/lib/db/queries/personas";

describe("generatePersonaStepHandler", () => {
  const ctx = {
    workflowRunId: "pipeline-run-1",
    stepId: "persona",
    trigger: "template" as const,
    forcePersona: false,
    personaStale: false,
    fetchImpl: fetch,
    env: process.env,
    appendThreadMessage: vi.fn(async () => {}),
  };

  it("aborts the step on PersonaGenerationUnavailableError", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockRejectedValue(
      new PersonaGenerationUnavailableError(
        "PERMISSION_REQUIRED",
        "Approve llm.chat for Signals in RealtimeX Settings → Local Apps.",
      ),
    );

    const report = await generatePersonaStepHandler(["c1", "c2", "c3"], ctx);

    expect(report.aborted).toBe(true);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.status).toBe("failed");
    expect(report.abortReason).toContain("Approve llm.chat");
  });
});
