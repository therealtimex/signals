import { describe, expect, it, vi } from "vitest";
import {
  buildCalibrationRows,
  buildCalibrationMetricRows,
} from "@/lib/wind-tunnel-calibration";

describe("buildCalibrationRows", () => {
  it("uses stored metricComparisons triples when present", () => {
    const rows = buildCalibrationRows({
      id: "cal-1",
      simulationRunId: "run-1",
      variantId: "var-1",
      contentItemId: "content-1",
      contentPostId: "post-1",
      observedFrom: 1,
      observedUntil: 2,
      actualScore: 12,
      actualMetrics: { likes: 15 },
      scoreError: -3,
      calibration: {
        predictedScore: 15,
        metricComparisons: {
          likes: { predicted: 10, actual: 15, error: 5 },
        },
      },
      source: "agent",
      workflowRunId: null,
      computedAt: 3,
    });

    expect(rows[0]).toEqual({
      metric: "score",
      predicted: 15,
      actual: 12,
      error: -3,
    });
    expect(rows[1]).toEqual({
      metric: "likes",
      predicted: 10,
      actual: 15,
      error: 5,
    });
  });

  it("falls back to predictedMetrics union when metricComparisons absent", () => {
    const rows = buildCalibrationRows(
      {
        id: "cal-1",
        simulationRunId: "run-1",
        variantId: "var-1",
        contentItemId: "content-1",
        contentPostId: "post-1",
        observedFrom: 1,
        observedUntil: 2,
        actualScore: 8,
        actualMetrics: { likes: 12 },
        scoreError: -2,
        calibration: {},
        source: "agent",
        workflowRunId: null,
        computedAt: 3,
      },
      { likes: 10 },
    );

    expect(rows.find((row) => row.metric === "likes")).toEqual({
      metric: "likes",
      predicted: 10,
      actual: 12,
      error: 2,
    });
  });
});

describe("buildCalibrationMetricRows", () => {
  it("still builds gtm-context rows from latest run and calibration", () => {
    const rows = buildCalibrationMetricRows({
      latestRun: {
        id: "run-1",
        variantId: "var-1",
        batchId: null,
        status: "completed",
        agentCount: 1,
        predictionModel: null,
        predictedScore: 20,
        predictionConfidence: 0.8,
        predictedMetrics: { likes: 10 },
        populationSpec: {},
        error: null,
        workflowRunId: null,
        scope: "shared",
        source: "agent",
        startedAt: 1,
        completedAt: 2,
        createdAt: 1,
        updatedAt: 2,
        transcriptsPrunedAt: null,
      },
      latestCalibration: {
        id: "cal-1",
        simulationRunId: "run-1",
        variantId: "var-1",
        contentItemId: "content-1",
        contentPostId: "post-1",
        observedFrom: 1,
        observedUntil: 2,
        actualScore: 12,
        actualMetrics: { likes: 15 },
        scoreError: -8,
        calibration: {},
        source: "agent",
        workflowRunId: null,
        computedAt: 3,
      },
    });

    expect(rows[0]?.metric).toBe("score");
    expect(rows[1]?.metric).toBe("likes");
  });
});
