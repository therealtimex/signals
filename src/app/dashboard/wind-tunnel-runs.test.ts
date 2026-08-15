import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { VariantDetailView } from "@/app/dashboard/launches/[id]/variants/[variantId]/variant-detail-view";
import VariantDetailPage from "@/app/dashboard/launches/[id]/variants/[variantId]/page";
import { RunDetailView } from "@/app/dashboard/simulations/[id]/run-detail-view";
import { RunAgentsTable } from "@/app/dashboard/simulations/[id]/run-agents-table";
import { db } from "@/lib/db/client";
import { calibrateSimulationRun } from "@/lib/db/queries/calibrations";
import { createContact } from "@/lib/db/queries/contacts";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  completeSimulationRun,
  createAndStartSimulationRun,
  getSimulationRun,
  recordSimulationAgentResults,
} from "@/lib/db/queries/simulations";
import { upsertPersona } from "@/lib/db/queries/personas";
import { getVariantById, publishVariant, upsertVariant } from "@/lib/db/queries/variants";
import {
  contentPosts,
  engagementMetrics,
  platformAccounts,
  simulationRuns,
} from "@/lib/db/schema";
import type { SimulationRun } from "@/lib/db/types";
import { scoreEngagementMetrics } from "@/lib/db/simulation-scoring";
import { resetCoreTables } from "@/test/db";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("UI 4.5 wind tunnel runs", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function updateRunTimestamps(
    runId: string,
    values: { completedAt: number | null; createdAt: number },
  ) {
    db.update(simulationRuns)
      .set({
        completedAt: values.completedAt,
        createdAt: values.createdAt,
        updatedAt: values.createdAt,
      })
      .where(eq(simulationRuns.id, runId))
      .run();
  }

  function seedMultiRunVariant() {
    const launch = upsertLaunch({ name: "Epic Launch", primaryPlatform: "x", status: "live" });
    const variant = upsertVariant({
      launchId: launch.id,
      label: "Hero",
      body: "Variant body copy",
      predictionModel: "model-z",
      simulatedAt: 1_700_000_000,
    });

    const contact = createContact({ name: "Grounded Agent", platform: "x", platformUserId: "g-1" });
    upsertPersona({
      contactId: contact.id,
      archetype: "Builder",
      tone: "Direct",
    });

    const older = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    const olderMetrics = { likes: 2 };
    const olderScore = scoreEngagementMetrics({
      likes: 2,
      comments: 0,
      shares: 0,
      impressions: 0,
      clicks: 0,
      bookmarks: 0,
      quotes: 0,
      retweets: 0,
    });
    completeSimulationRun(older.run.id, {
      predictedScore: olderScore,
      predictionConfidence: 0.5,
      predictedMetrics: olderMetrics,
    });
    updateRunTimestamps(older.run.id, {
      completedAt: 1_700_000_100,
      createdAt: 1_700_000_050,
    });

    const newer = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(newer.run.id, [
      {
        agentId: newer.agents[0]!.id,
        engagementScore: 44,
        outcome: "like",
      },
    ]);
    const newerMetrics = { likes: 4 };
    const newerScore = scoreEngagementMetrics({
      likes: 4,
      comments: 0,
      shares: 0,
      impressions: 0,
      clicks: 0,
      bookmarks: 0,
      quotes: 0,
      retweets: 0,
    });
    completeSimulationRun(newer.run.id, {
      predictedScore: newerScore,
      predictionConfidence: 0.6,
      predictedMetrics: newerMetrics,
    });
    updateRunTimestamps(newer.run.id, {
      completedAt: 1_700_000_200,
      createdAt: 1_700_000_150,
    });

    const failed = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    completeSimulationRun(failed.run.id, {
      status: "failed",
      error: "Wind tunnel blew up",
    });
    updateRunTimestamps(failed.run.id, {
      completedAt: null,
      createdAt: 1_700_000_300,
    });

    const runs: SimulationRun[] = [
      getSimulationRun(failed.run.id)!,
      getSimulationRun(newer.run.id)!,
      getSimulationRun(older.run.id)!,
    ];

    const refreshedVariant = getVariantById(variant.id)!;

    return {
      launch,
      variant: refreshedVariant,
      runs,
      projectionSourceRunId: newer.run.id,
    };
  }

  it("variant detail smoke renders runs, projection source badge, and empty state copy", () => {
    const { launch, variant, runs, projectionSourceRunId } = seedMultiRunVariant();

    const html = renderToStaticMarkup(
      createElement(VariantDetailView, {
        launch,
        variant,
        runs,
        runsTotal: runs.length,
        runsPage: 1,
        runsPageSize: 20,
        projectionSourceRunId,
      }),
    );

    expect(html).toContain("Hero");
    expect(html).toContain("4.00");
    expect(html).toContain("60%");
    expect(html).toContain("Projection source");
    expect(html).toContain("failed");
    expect(html).toContain("Projected from the latest completed run below.");
    expect(html).toContain("Variant body copy");

    const emptyHtml = renderToStaticMarkup(
      createElement(VariantDetailView, {
        launch,
        variant,
        runs: [],
        runsTotal: 0,
        runsPage: 1,
        runsPageSize: 20,
        projectionSourceRunId: null,
      }),
    );
    expect(emptyHtml).toContain("No simulation runs yet");
    expect(emptyHtml).toContain(
      "Runs live in your terminal agent — ask it to run the Wind Tunnel on this variant. The dashboard is read-only.",
    );
  });

  it("variant detail page server render accepts multi-run fixture without function props", async () => {
    const { launch, variant } = seedMultiRunVariant();
    const page = await VariantDetailPage({
      params: Promise.resolve({ id: launch.id, variantId: variant.id }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Hero");
    expect(html).toContain("Simulation runs");
    expect(html).toContain("failed");
    expect(html).toContain("Projection source");
  });

  it("run detail smoke renders agents, calibration horizons, error callout, and pruned transcripts", () => {
    const { launch, variant, projectionSourceRunId, runs } = seedMultiRunVariant();
    const run = getSimulationRun(projectionSourceRunId)!;

    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: 1_700_000_000,
    });
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@brand",
        authType: "oauth",
      })
      .run();
    const postId = nanoid();
    db.insert(contentPosts)
      .values({
        id: postId,
        contentItemId: published.contentItemId!,
        platformAccountId,
        publishedAt: 1_700_000_000,
        status: "published",
      })
      .run();
    db.insert(engagementMetrics)
      .values({
        id: nanoid(),
        contentPostId: postId,
        snapshotAt: 1_700_000_100,
        likes: 6,
        comments: 0,
        shares: 0,
        impressions: 0,
        clicks: 0,
        bookmarks: 0,
        quotes: 0,
        retweets: 0,
      })
      .run();

    calibrateSimulationRun(run.id, { observedUntil: 1_700_001_000 });
    calibrateSimulationRun(run.id, { observedUntil: 1_700_001_500 });

    const detail = getSimulationRun(run.id, {
      includeAgents: true,
      includeCalibration: true,
    })!;

    const agentRows = detail.agents!.map((agent) => ({
      id: agent.id,
      contactId: agent.contactId,
      engagementScore: agent.engagementScore,
      outcome: agent.outcome,
      grounding: agent.grounding,
    }));

    const html = renderToStaticMarkup(
      createElement(RunDetailView, {
        run: detail,
        agents: agentRows,
        calibrations: detail.calibrations ?? [],
        variant,
        launch,
      }),
    );

    expect(html).toContain("Grounded Agent");
    expect(html).toContain("44.00");
    expect(html).toContain("like");
    expect(html).toContain("Latest");
    expect(html).toContain("Observed until");
    expect(html).toContain("score");

    const failedRun = runs.find((entry) => entry.status === "failed")!;
    const failedHtml = renderToStaticMarkup(
      createElement(RunDetailView, {
        run: failedRun,
        agents: [],
        calibrations: [],
        variant,
        launch,
      }),
    );
    expect(failedHtml).toContain("Run failed");
    expect(failedHtml).toContain("Wind tunnel blew up");

    const prunedHtml = renderToStaticMarkup(
      createElement(RunAgentsTable, {
        runId: run.id,
        agents: agentRows,
        transcriptsPrunedAt: 1_700_002_000,
      }),
    );
    expect(prunedHtml).toContain("Pruned");
    expect(prunedHtml).not.toContain("Show transcript");
  });
});
