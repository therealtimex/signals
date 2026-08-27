import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PersonaEvidenceError,
  PersonaGenerationUnavailableError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import { generatePersonaStepHandler } from "@/lib/workflows/pipeline/handlers/generate-persona-step";
import type { PipelineStepContext } from "@/lib/workflows/pipeline/types";

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
import { refreshPersonaIfStale } from "@/lib/workflows/refresh-persona-if-stale";
import { getActivePersona } from "@/lib/db/queries/personas";

function makeCtx(overrides?: Partial<PipelineStepContext>): PipelineStepContext {
  return {
    workflowRunId: "pipeline-run-1",
    stepId: "persona",
    trigger: "template",
    forcePersona: false,
    personaStale: false,
    fetchImpl: fetch,
    env: process.env,
    appendThreadMessage: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("generatePersonaStepHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps generated with child workflow run id", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockResolvedValue({
      generated: true,
      persona: {} as never,
      workflowRunId: "child-run-1",
      supersededPersonaId: null,
      nicheEdgesUpserted: 0,
      embedded: false,
    });

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "generated",
      detail: { personaWorkflowRunId: "child-run-1" },
    });
    expect(generatePersona).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        parentWorkflowId: "pipeline-run-1",
        trigger: "user",
        force: false,
      }),
    );
  });

  it("maps evidence_unchanged skip from generatePersona", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockResolvedValue({
      generated: false,
      skipped: true,
      reason: "evidence_unchanged",
      personaId: "p1",
    });

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "evidence_unchanged",
    });
  });

  it("maps fresh skip from refreshPersonaIfStale when personaStale", async () => {
    vi.mocked(getActivePersona).mockReturnValue({
      scope: "shared",
    } as never);
    vi.mocked(refreshPersonaIfStale).mockResolvedValue({
      refreshed: false,
      skipped: true,
      reason: "fresh",
    });

    const report = await generatePersonaStepHandler(
      ["c1"],
      makeCtx({ personaStale: true }),
    );

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "fresh",
    });
    expect(refreshPersonaIfStale).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ parentWorkflowId: "pipeline-run-1" }),
    );
  });

  it("maps insufficient_evidence from PersonaEvidenceError", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockRejectedValue(new PersonaEvidenceError("not enough"));

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "insufficient_evidence",
    });
  });

  it("maps local_only from active local_only persona without calling generate", async () => {
    vi.mocked(getActivePersona).mockReturnValue({ scope: "local_only" } as never);

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "local_only",
    });
    expect(generatePersona).not.toHaveBeenCalled();
  });

  it("maps local_only from PersonaScopeError", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockRejectedValue(new PersonaScopeError("local only"));

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "local_only",
    });
  });

  it("maps failed from PersonaSynthesisError", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockRejectedValue(
      new PersonaSynthesisError("schema validation failed"),
    );

    const report = await generatePersonaStepHandler(["c1"], makeCtx());

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "failed",
      reason: "schema validation failed",
    });
    expect(report.aborted).toBe(false);
  });

  it("maps not_eligible when shared persona exists and personaStale is off", async () => {
    vi.mocked(getActivePersona).mockReturnValue({ scope: "shared" } as never);

    const report = await generatePersonaStepHandler(["c1"], makeCtx({ personaStale: false }));

    expect(report.outcomes[0]).toEqual({
      contactId: "c1",
      status: "skipped",
      reason: "not_eligible",
    });
  });

  it("passes force:true only on template trigger, not scheduled", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockResolvedValue({
      generated: true,
      persona: {} as never,
      workflowRunId: "child-run-2",
      supersededPersonaId: null,
      nicheEdgesUpserted: 0,
      embedded: false,
    });

    await generatePersonaStepHandler(
      ["c1"],
      makeCtx({ forcePersona: true, trigger: "template" }),
    );
    expect(generatePersona).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ force: true, trigger: "user" }),
    );

    vi.mocked(generatePersona).mockClear();
    await generatePersonaStepHandler(
      ["c2"],
      makeCtx({ forcePersona: true, trigger: "scheduled" }),
    );
    expect(generatePersona).toHaveBeenCalledWith(
      "c2",
      expect.objectContaining({ force: false, trigger: "scheduled" }),
    );
  });

  it("aborts the step on PersonaGenerationUnavailableError", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona).mockRejectedValue(
      new PersonaGenerationUnavailableError(
        "PERMISSION_REQUIRED",
        "Approve llm.chat for Signals in RealtimeX Settings → Local Apps.",
      ),
    );

    const report = await generatePersonaStepHandler(["c1", "c2", "c3"], makeCtx());

    expect(report.aborted).toBe(true);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.status).toBe("failed");
    expect(report.abortReason).toContain("Approve llm.chat");
  });

  it("records agent timeout as a per-contact failure and continues the batch", async () => {
    vi.mocked(getActivePersona).mockReturnValue(undefined);
    vi.mocked(generatePersona)
      .mockRejectedValueOnce(
        new PersonaGenerationUnavailableError("AGENT_TIMEOUT", "Agent timed out"),
      )
      .mockResolvedValueOnce({
        generated: true,
        persona: {} as never,
        workflowRunId: "child-run-2",
        supersededPersonaId: null,
        nicheEdgesUpserted: 0,
        embedded: false,
      });

    const report = await generatePersonaStepHandler(["c1", "c2"], makeCtx());

    expect(report.aborted).toBe(false);
    expect(report.outcomes).toEqual([
      { contactId: "c1", status: "failed", reason: "Agent timed out" },
      {
        contactId: "c2",
        status: "generated",
        detail: { personaWorkflowRunId: "child-run-2" },
      },
    ]);
  });
});
