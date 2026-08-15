import { describe, expect, it } from "vitest";
import type { SimulationRun } from "@/lib/db/types";
import { findProjectionSourceRunId, summarizeAgentGrounding } from "@/lib/simulation-run-display";

function runFixture(
  overrides: Partial<SimulationRun> & Pick<SimulationRun, "id" | "status">,
): SimulationRun {
  return {
    id: overrides.id,
    variantId: overrides.variantId ?? "var-1",
    batchId: overrides.batchId ?? null,
    status: overrides.status,
    agentCount: overrides.agentCount ?? 1,
    predictionModel: overrides.predictionModel ?? null,
    predictedScore: overrides.predictedScore ?? null,
    predictionConfidence: overrides.predictionConfidence ?? null,
    predictedMetrics: overrides.predictedMetrics ?? "{}",
    populationSpec: overrides.populationSpec ?? "{}",
    config: overrides.config ?? null,
    error: overrides.error ?? null,
    workflowRunId: overrides.workflowRunId ?? null,
    scope: overrides.scope ?? "shared",
    source: overrides.source ?? "agent",
    startedAt: overrides.startedAt ?? 1,
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    transcriptsPrunedAt: overrides.transcriptsPrunedAt ?? null,
  };
}

describe("findProjectionSourceRunId", () => {
  it("picks max completedAt among completed runs and ignores other statuses", () => {
    const older = runFixture({
      id: "run-old",
      status: "completed",
      completedAt: 100,
      createdAt: 10,
    });
    const newer = runFixture({
      id: "run-new",
      status: "completed",
      completedAt: 200,
      createdAt: 5,
    });
    const failed = runFixture({
      id: "run-fail",
      status: "failed",
      completedAt: 500,
      createdAt: 20,
    });
    const pending = runFixture({
      id: "run-pending",
      status: "pending",
      completedAt: null,
      createdAt: 30,
    });

    expect(findProjectionSourceRunId([failed, older, newer, pending])).toBe("run-new");
  });

  it("returns null when no completed runs exist", () => {
    expect(
      findProjectionSourceRunId([
        runFixture({ id: "a", status: "failed", completedAt: 1 }),
        runFixture({ id: "b", status: "running", completedAt: null }),
      ]),
    ).toBeNull();
  });

  it("tiebreaks equal completedAt by id desc, not createdAt", () => {
    const olderCreated = runFixture({
      id: "aaa",
      status: "completed",
      completedAt: 100,
      createdAt: 60,
    });
    const newerId = runFixture({
      id: "bbb",
      status: "completed",
      completedAt: 100,
      createdAt: 10,
    });

    expect(findProjectionSourceRunId([olderCreated, newerId])).toBe("bbb");
  });
});

describe("summarizeAgentGrounding", () => {
  it("uses contact name when present", () => {
    const summary = summarizeAgentGrounding({
      contact: { name: "Alex Rivera" },
      persona: { archetype: "Builder", tone: "Direct" },
    });
    expect(summary).toEqual({ name: "Alex Rivera", headline: "Builder · Direct" });
  });

  it("falls back to identity displayName then platformHandle then Agent", () => {
    expect(
      summarizeAgentGrounding({
        identities: [{ displayName: "Display", bio: "Bio line" }],
      }),
    ).toEqual({ name: "Display", headline: "Bio line" });

    expect(
      summarizeAgentGrounding({
        identities: [{ platformHandle: "@handle" }],
      }),
    ).toEqual({ name: "@handle", headline: null });

    expect(summarizeAgentGrounding({})).toEqual({ name: "Agent", headline: null });
  });
});
