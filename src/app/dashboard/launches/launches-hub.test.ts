import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { nanoid } from "nanoid";
import { WindTunnelSection } from "@/components/wind-tunnel-section";
import type { ContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { resetCoreTables } from "@/test/db";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LaunchesListView } from "@/app/dashboard/launches/launches-list-view";
import { LaunchDetailView } from "@/app/dashboard/launches/launch-detail-view";
import { createGoal } from "@/lib/db/queries/goals";
import { getLaunchWithDetails, upsertLaunch } from "@/lib/db/queries/launches";
import { upsertGraphEdge } from "@/lib/db/queries/graph";
import { publishVariant, upsertVariant } from "@/lib/db/queries/variants";

describe("UI 4.4 launches hub", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedSharedLaunchFixture() {
    const goal = createGoal({
      name: "Grow audience",
      goalType: "audience_growth",
      targetValue: 100,
      unit: "followers",
    });
    const launch = upsertLaunch({
      name: "Summer Launch",
      brief: "Announce the feature",
      primaryPlatform: "x",
      status: "live",
      scope: "shared",
    });
    upsertGraphEdge({
      edgeType: "contributes_to",
      srcType: "launch",
      srcId: launch.id,
      dstType: "goal",
      dstId: goal.id,
      scope: "shared",
      source: "test",
    });

    const draft = upsertVariant({
      launchId: launch.id,
      label: "Draft A",
      body: "draft copy",
      variantType: "post",
      status: "draft",
    });
    const publishedSource = upsertVariant({
      launchId: launch.id,
      label: "Winner",
      body: "published copy",
      variantType: "post",
      predictedScore: 42.5,
      predictionConfidence: 0.8,
      simulatedAt: 1_700_000_000,
    });
    const published = publishVariant(publishedSource.id, {
      platform: "x",
      publishedAt: 1_700_000_100,
    });

    return { launch, goal, draft, published };
  }

  it("getLaunchWithDetails summaries include extended variant fields", () => {
    const { launch, published } = seedSharedLaunchFixture();
    const details = getLaunchWithDetails(launch.id, { includeLocalOnly: true });
    const publishedSummary = details?.variants.find((variant) => variant.id === published.id);

    expect(publishedSummary).toMatchObject({
      variantType: "post",
      predictionConfidence: 0.8,
      simulatedAt: 1_700_000_000,
      contentItemId: published.contentItemId,
      predictedScore: 42.5,
      createdAt: expect.any(Number),
    });
    expect(Object.keys(publishedSummary ?? {})).not.toContain("updatedAt");
  });

  it("list view renders five table cells per row with variant and goal counts", () => {
    const { launch } = seedSharedLaunchFixture();
    const details = getLaunchWithDetails(launch.id, { includeLocalOnly: true })!;
    const html = renderToStaticMarkup(createElement(LaunchesListView, { launches: [details] }));

    expect(html).toContain("Summer Launch");
    expect(html).toContain("live");
    expect(html).toContain("2 variants · 1 published");
    expect(html).toContain(">1<");
    expect(html).not.toContain('colSpan="5"');
    expect(html).toContain('role="link"');
    expect(html).toContain('aria-label="Open launch Summer Launch"');
    expect((html.match(/data-slot="table-cell"/g) ?? []).length).toBe(5);
  });

  it("list view shows Private badge for local_only launches when included", () => {
    const privateLaunch = upsertLaunch({
      name: "Private Launch",
      scope: "local_only",
      status: "draft",
    });
    const details = getLaunchWithDetails(privateLaunch.id, { includeLocalOnly: true })!;
    const html = renderToStaticMarkup(createElement(LaunchesListView, { launches: [details] }));

    expect(html).toContain("Private Launch");
    expect(html).toContain("Private");
  });

  it("detail view renders brief, goal chip, and variant board rows", () => {
    const { launch, goal, published } = seedSharedLaunchFixture();
    const details = getLaunchWithDetails(launch.id, { includeLocalOnly: true })!;
    const html = renderToStaticMarkup(
      createElement(LaunchDetailView, {
        launch: details,
        linkedGoals: [{ id: goal.id, name: goal.name }],
        onEditVariant: () => {},
      }),
    );

    expect(html).toContain("Announce the feature");
    expect(html).toContain("Grow audience");
    expect(html).toContain(`/dashboard/goals/${goal.id}`);
    expect(html).toContain("Winner");
    expect(html).toContain(`/dashboard/launches/${launch.id}/variants/${published.id}`);
    expect(html).toContain("42.50");
    expect(html).toContain("80%");
    expect(html).toContain(`/dashboard/content/${published.contentItemId}`);
    expect(html).toContain("Draft A");
    expect(html).toContain(">—<");
    expect(html).toContain('aria-label="Published variants are read-only"');
    expect(html).toContain('data-slot="tooltip-trigger"');
  });

  it("detail view renders local_only guard callout and Private badge", () => {
    const launch = upsertLaunch({
      name: "Private Launch",
      scope: "local_only",
      status: "draft",
    });
    const details = getLaunchWithDetails(launch.id, { includeLocalOnly: true })!;
    const html = renderToStaticMarkup(
      createElement(LaunchDetailView, {
        launch: details,
        linkedGoals: [],
      }),
    );

    expect(html).toContain("Private launch — Wind Tunnel simulation is blocked.");
    expect(html).toContain("Set scope to Shared");
    expect(html).toContain("Private");
  });

  it("shared launch detail does not render guard callout", () => {
    const { launch } = seedSharedLaunchFixture();
    const details = getLaunchWithDetails(launch.id, { includeLocalOnly: true })!;
    const html = renderToStaticMarkup(
      createElement(LaunchDetailView, {
        launch: details,
        linkedGoals: [],
      }),
    );

    expect(html).not.toContain("Wind Tunnel simulation is blocked");
  });
});

describe("WindTunnelSection launch link", () => {
  it("links launch name to the launches detail route", () => {
    const gtm: ContentGtmContext = {
      contentItemId: "content-1",
      variant: {
        id: "var-1",
        launchId: "launch-1",
        label: "A",
        variantType: "post",
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
        id: "launch-abc",
        name: "Summer Launch",
        status: "live",
        scope: "shared",
      },
      latestRun: null,
      latestCalibration: null,
    };

    const html = renderToStaticMarkup(createElement(WindTunnelSection, { gtm }));
    expect(html).toContain('href="/dashboard/launches/launch-abc"');
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain("Launch detail coming soon");
  });
});
