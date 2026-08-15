import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { GET as getGtmContextRoute } from "@/app/api/content/[id]/gtm-context/route";
import { db } from "@/lib/db/client";
import {
  contentActivities,
  contentPosts,
  engagementMetrics,
  interactions,
  platformAccounts,
} from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createContentItem } from "@/lib/db/queries/content";
import { calibrateSimulationRun } from "@/lib/db/queries/calibrations";
import { getContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { createEngagement } from "@/lib/db/queries/engagements";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  completeSimulationRun,
  createAndStartSimulationRun,
  recordSimulationAgentResults,
} from "@/lib/db/queries/simulations";
import { publishVariant, upsertVariant } from "@/lib/db/queries/variants";
import { scoreEngagementMetrics } from "@/lib/db/simulation-scoring";
import { resetCoreTables } from "@/test/db";

const PUBLISHED_AT = 1_700_000_000;
const OBSERVED_UNTIL = PUBLISHED_AT + 1000;

function collectKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      keys.push(...collectKeys(nested).map((k) => `${key}.${k}`));
    }
  }
  return keys.sort();
}

describe("getContentGtmContext", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  function seedPlatformAccount() {
    const platformAccountId = nanoid();
    db.insert(platformAccounts)
      .values({
        id: platformAccountId,
        platform: "x",
        displayName: "@brand",
        authType: "oauth",
      })
      .run();
    return platformAccountId;
  }

  function insertContentPost(contentItemId: string, publishedAt: number) {
    const postId = nanoid();
    db.insert(contentPosts)
      .values({
        id: postId,
        contentItemId,
        platformAccountId: seedPlatformAccount(),
        publishedAt,
        status: "published",
      })
      .run();
    return postId;
  }

  function seedLikeEvents(
    contentPostId: string,
    count: number,
    occurredAt: number,
    scope: "shared" | "local_only" = "shared",
  ) {
    const contact = createContact({
      name: `Reader ${nanoid(4)}`,
      platform: "x",
      platformUserId: nanoid(),
    });
    for (let i = 0; i < count; i += 1) {
      if (scope === "shared") {
        createEngagement({
          contactId: contact.id,
          platformAccountId: null,
          engagementType: "like",
          direction: "outbound",
          contentPostId,
          platform: "x",
          source: "manual",
          platformEngagementId: nanoid(),
          content: null,
          templateId: null,
          workflowRunId: null,
          threadId: null,
          platformData: "{}",
        });
        db.update(interactions)
          .set({ occurredAt, scope: "shared" })
          .where(eq(interactions.contactId, contact.id))
          .run();
      } else {
        db.insert(interactions)
          .values({
            id: nanoid(),
            contactId: contact.id,
            interactionType: "like",
            direction: "outbound",
            occurredAt,
            scope: "local_only",
            source: "agent",
            contentPostId,
            platform: "x",
          })
          .run();
      }
    }
  }

  function seedFullFixture() {
    const contact = createContact({ name: "GTM", platform: "x", platformUserId: "gtm-ctx" });
    const launch = upsertLaunch({ name: "Wind Tunnel Launch", primaryPlatform: "x" });
    const variant = upsertVariant({
      launchId: launch.id,
      body: "published copy",
      label: "A",
      predictedScore: 18,
      predictionConfidence: 0.75,
      predictionModel: "test-model",
      simulatedAt: PUBLISHED_AT - 100,
    });
    const metrics = { likes: 10 };
    const score = scoreEngagementMetrics({
      likes: 10,
      comments: 0,
      shares: 0,
      impressions: 0,
      clicks: 0,
      bookmarks: 0,
      quotes: 0,
      retweets: 0,
    });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: score,
      predictionConfidence: 0.8,
      predictedMetrics: metrics,
    });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: PUBLISHED_AT,
    });
    const postId = insertContentPost(published.contentItemId!, PUBLISHED_AT);
    db.insert(engagementMetrics)
      .values({
        id: nanoid(),
        contentPostId: postId,
        snapshotAt: PUBLISHED_AT + 100,
        likes: 12,
        comments: 0,
        shares: 0,
        impressions: 0,
        clicks: 0,
        bookmarks: 0,
        quotes: 0,
        retweets: 0,
      })
      .run();
    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });
    return { published, run, calibration, launch };
  }

  it("returns null for unknown content item id", () => {
    expect(getContentGtmContext("missing-content")).toBeNull();
  });

  it("returns full lineage with variant, run, and calibration", () => {
    const { published, run, calibration } = seedFullFixture();
    const ctx = getContentGtmContext(published.contentItemId!);

    expect(ctx).not.toBeNull();
    expect(ctx!.contentItemId).toBe(published.contentItemId);
    expect(ctx!.variant?.id).toBe(published.id);
    expect(ctx!.launch?.name).toBe("Wind Tunnel Launch");
    expect(ctx!.latestRun?.id).toBe(run.id);
    expect(ctx!.latestRun?.status).toBe("completed");
    expect(ctx!.latestCalibration?.simulationRunId).toBe(run.id);
    expect(ctx!.latestCalibration?.actualScore).toBe(calibration.actualScore);
    expect(ctx!.latestCalibration?.scoreError).toBe(calibration.scoreError);
  });

  it("progressive nulls: no variant", () => {
    const item = createContentItem({
      title: "Draft",
      body: "hello",
      contentType: "post",
      origin: "authored",
      direction: "outbound",
      status: "draft",
    });
    const ctx = getContentGtmContext(item.id);
    expect(ctx?.variant).toBeNull();
    expect(ctx?.launch).toBeNull();
    expect(ctx?.latestRun).toBeNull();
    expect(ctx?.latestCalibration).toBeNull();
  });

  it("progressive nulls: variant without completed run", () => {
    const launch = upsertLaunch({ name: "No Run", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "only variant" });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: PUBLISHED_AT,
    });
    const ctx = getContentGtmContext(published.contentItemId!);
    expect(ctx?.variant?.id).toBe(published.id);
    expect(ctx?.launch?.name).toBe("No Run");
    expect(ctx?.latestRun).toBeNull();
    expect(ctx?.latestCalibration).toBeNull();
  });

  it("progressive nulls: run without calibration (unpublished variant)", () => {
    const contact = createContact({ name: "No Cal", platform: "x", platformUserId: "nc-1" });
    const launch = upsertLaunch({ name: "Draft Run", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "draft copy" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: 10,
      predictionConfidence: 0.5,
      predictedMetrics: { likes: 5 },
    });
    const item = createContentItem({
      title: "Linked",
      body: variant.body,
      contentType: "post",
      origin: "authored",
      direction: "outbound",
      status: "draft",
    });
    upsertVariant({
      id: variant.id,
      launchId: launch.id,
      body: variant.body,
      contentItemId: item.id,
      status: "draft",
    });
    const ctx = getContentGtmContext(item.id);
    expect(ctx?.latestRun?.id).toBe(run.id);
    expect(ctx?.latestCalibration).toBeNull();
    expect(ctx?.variant?.status).toBe("draft");
  });

  it("progressive nulls: published variant with run but no calibration row", () => {
    const contact = createContact({ name: "Pub", platform: "x", platformUserId: "pub-1" });
    const launch = upsertLaunch({ name: "Published", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "live copy" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore: 10,
      predictionConfidence: 0.5,
      predictedMetrics: { likes: 5 },
    });
    const published = publishVariant(variant.id, {
      platform: "x",
      publishedAt: PUBLISHED_AT,
    });
    const ctx = getContentGtmContext(published.contentItemId!);
    expect(ctx?.variant?.status).toBe("published");
    expect(ctx?.latestRun?.id).toBe(run.id);
    expect(ctx?.latestCalibration).toBeNull();
  });

  it("§8.5: calibration values are invariant to local_only evidence on re-read", () => {
    const { published, run } = seedFullFixture();
    const contentItemId = published.contentItemId!;
    const postId = db
      .select()
      .from(contentPosts)
      .where(eq(contentPosts.contentItemId, contentItemId))
      .all()[0]!.id;

    const before = getContentGtmContext(contentItemId)!.latestCalibration!;
    const persisted = {
      actualScore: before.actualScore,
      actualMetrics: before.actualMetrics,
      scoreError: before.scoreError,
    };

    seedLikeEvents(postId, 100, PUBLISHED_AT + 60, "local_only");
    db.insert(contentActivities)
      .values({
        id: nanoid(),
        activityType: "like",
        direction: "outbound",
        occurredAt: PUBLISHED_AT + 70,
        scope: "local_only",
        source: "agent",
        contentPostId: postId,
        platform: "x",
      })
      .run();

    const after = getContentGtmContext(contentItemId)!.latestCalibration!;
    expect(after.simulationRunId).toBe(run.id);
    expect(after.actualScore).toBe(persisted.actualScore);
    expect(after.actualMetrics).toEqual(persisted.actualMetrics);
    expect(after.scoreError).toBe(persisted.scoreError);
  });

  it("gtm-context route: 404 unknown and 200 shape regression", async () => {
    const missing = await getGtmContextRoute(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "missing-content" }),
    });
    expect(missing.status).toBe(404);

    const { published } = seedFullFixture();
    const res = await getGtmContextRoute(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: published.contentItemId! }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const direct = getContentGtmContext(published.contentItemId!);
    expect(collectKeys(body)).toEqual(collectKeys(direct));
    expect(body).toEqual(direct);
  });
});
