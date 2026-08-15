import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WindTunnelSection } from "@/components/wind-tunnel-section";
import { buildCalibrationMetricRows } from "@/lib/wind-tunnel-calibration";
import type { ContentGtmContext } from "@/lib/db/queries/content-gtm-context";

function baseGtm(overrides: Partial<ContentGtmContext> = {}): ContentGtmContext {
  return {
    contentItemId: "content-1",
    variant: null,
    launch: null,
    latestRun: null,
    latestCalibration: null,
    ...overrides,
  };
}

describe("buildCalibrationMetricRows", () => {
  it("includes score row with stored scoreError and per-metric actual − predicted", () => {
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

    expect(rows[0]).toEqual({
      metric: "score",
      predicted: 20,
      actual: 12,
      error: -8,
    });
    expect(rows[1]).toEqual({
      metric: "likes",
      predicted: 10,
      actual: 15,
      error: 5,
    });
  });
});

describe("WindTunnelSection", () => {
  it("renders full fixture with launch name, predicted score, and calibration table", () => {
    const gtm = baseGtm({
      variant: {
        id: "var-1",
        launchId: "launch-1",
        label: "A",
        variantType: "primary",
        body: "copy",
        contentItemId: "content-1",
        status: "published",
        predictedScore: 42.5,
        predictionConfidence: 0.9,
        predictedMetrics: {},
        predictionModel: "model-x",
        simulatedAt: 1_700_000_000,
        generationModel: null,
        generationMetadata: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      },
      launch: {
        id: "launch-1",
        name: "Summer Launch",
        status: "live",
        scope: "shared",
      },
      latestRun: {
        id: "run-1",
        variantId: "var-1",
        batchId: null,
        status: "completed",
        agentCount: 1,
        predictionModel: "model-x",
        predictedScore: 40,
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
        observedFrom: 1_700_000_000,
        observedUntil: 1_700_001_000,
        actualScore: 38,
        actualMetrics: { likes: 12 },
        scoreError: -2,
        calibration: {},
        source: "agent",
        workflowRunId: null,
        computedAt: 1_700_002_000,
      },
    });

    const html = renderToStaticMarkup(createElement(WindTunnelSection, { gtm }));
    expect(html).toContain("Summer Launch");
    expect(html).toContain("42.50");
    expect(html).toContain("Calibration");
    expect(html).toContain("score");
    expect(html).toContain("likes");
    expect(html).toContain('href="/dashboard/launches/launch-1"');
    expect(html).toContain('href="/dashboard/launches/launch-1/variants/var-1"');
    expect(html).toContain('href="/dashboard/simulations/run-1"');
    expect(html).toContain("View run →");
  });

  it("renders empty-state copy for each progressive-null level", () => {
    const noVariant = renderToStaticMarkup(
      createElement(WindTunnelSection, { gtm: baseGtm() }),
    );
    expect(noVariant).toContain(
      "Not part of a GTM launch yet. Create a variant from a launch to see Wind Tunnel projections.",
    );

    const noRun = renderToStaticMarkup(
      createElement(
        WindTunnelSection,
        {
          gtm: baseGtm({
            variant: {
              id: "var-1",
              launchId: "launch-1",
              label: "A",
              variantType: "primary",
              body: "copy",
              contentItemId: "content-1",
              status: "draft",
              predictedScore: null,
              predictionConfidence: null,
              predictedMetrics: {},
              predictionModel: null,
              simulatedAt: null,
              generationModel: null,
              generationMetadata: {},
              metadata: {},
              createdAt: 1,
              updatedAt: 1,
            },
            launch: {
              id: "launch-1",
              name: "Draft Launch",
              status: "draft",
              scope: "shared",
            },
          }),
        },
      ),
    );
    expect(noRun).toContain(
      "No completed simulation runs yet. Run the Wind Tunnel from your terminal agent.",
    );

    const unpublishedNoCal = renderToStaticMarkup(
      createElement(
        WindTunnelSection,
        {
          gtm: baseGtm({
            variant: {
              id: "var-1",
              launchId: "launch-1",
              label: "A",
              variantType: "primary",
              body: "copy",
              contentItemId: "content-1",
              status: "draft",
              predictedScore: 10,
              predictionConfidence: 0.5,
              predictedMetrics: {},
              predictionModel: "m",
              simulatedAt: 1,
              generationModel: null,
              generationMetadata: {},
              metadata: {},
              createdAt: 1,
              updatedAt: 1,
            },
            launch: {
              id: "launch-1",
              name: "Draft Launch",
              status: "draft",
              scope: "shared",
            },
            latestRun: {
              id: "run-1",
              variantId: "var-1",
              batchId: null,
              status: "completed",
              agentCount: 1,
              predictionModel: null,
              predictedScore: 10,
              predictionConfidence: 0.5,
              predictedMetrics: {},
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
          }),
        },
      ),
    );
    expect(unpublishedNoCal).toContain("Calibration starts after this variant is published.");

    const publishedNoCal = renderToStaticMarkup(
      createElement(
        WindTunnelSection,
        {
          gtm: baseGtm({
            variant: {
              id: "var-1",
              launchId: "launch-1",
              label: "A",
              variantType: "primary",
              body: "copy",
              contentItemId: "content-1",
              status: "published",
              predictedScore: 10,
              predictionConfidence: 0.5,
              predictedMetrics: {},
              predictionModel: "m",
              simulatedAt: 1,
              generationModel: null,
              generationMetadata: {},
              metadata: {},
              createdAt: 1,
              updatedAt: 1,
            },
            launch: {
              id: "launch-1",
              name: "Live Launch",
              status: "live",
              scope: "shared",
            },
            latestRun: {
              id: "run-1",
              variantId: "var-1",
              batchId: null,
              status: "completed",
              agentCount: 1,
              predictionModel: null,
              predictedScore: 10,
              predictionConfidence: 0.5,
              predictedMetrics: {},
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
          }),
        },
      ),
    );
    expect(publishedNoCal).toContain(
      "No calibration yet — actuals are compared after the observation window.",
    );
  });

  it("renders Private launch badge for local_only scope", () => {
    const html = renderToStaticMarkup(
      createElement(
        WindTunnelSection,
        {
          gtm: baseGtm({
            variant: {
              id: "var-1",
              launchId: "launch-1",
              label: "A",
              variantType: "primary",
              body: "copy",
              contentItemId: "content-1",
              status: "published",
              predictedScore: 10,
              predictionConfidence: 0.5,
              predictedMetrics: {},
              predictionModel: "m",
              simulatedAt: 1,
              generationModel: null,
              generationMetadata: {},
              metadata: {},
              createdAt: 1,
              updatedAt: 1,
            },
            launch: {
              id: "launch-1",
              name: "Private",
              status: "live",
              scope: "local_only",
            },
          }),
        },
      ),
    );
    expect(html).toContain("Private launch");
  });
});
