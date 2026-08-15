import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { db } from "@/lib/db/client";
import {
  contentActivities,
  contentPosts,
  engagementMetrics,
  interactions,
  platformAccounts,
  scheduledJobs,
  simulationCalibrations,
  workflowRuns,
} from "@/lib/db/schema";
import { createContact } from "@/lib/db/queries/contacts";
import { createEngagement } from "@/lib/db/queries/engagements";
import { upsertLaunch } from "@/lib/db/queries/launches";
import {
  calibrateSimulationRun,
  computeCalibrationActualsForRun,
  getLatestCalibrationForRun,
  listCalibrationsForRun,
} from "@/lib/db/queries/calibrations";
import { CalibrationSourceError } from "@/lib/db/queries/simulation-errors";
import {
  completeSimulationRun,
  createAndStartSimulationRun,
  getSimulationRun,
  recordSimulationAgentResults,
} from "@/lib/db/queries/simulations";
import { publishVariant, upsertVariant } from "@/lib/db/queries/variants";
import {
  runSimulationCalibrationSweep,
  SIMULATION_CALIBRATION_SWEEP_JOB_TYPE,
} from "@/lib/db/simulation-calibration-sweep";
import { executeScheduledJob } from "@/lib/scheduler/runner";
import { getScheduledJob } from "@/lib/db/queries/scheduled-jobs";
import { scoreEngagementMetrics } from "@/lib/db/simulation-scoring";
import { assertNoPrivacySentinels } from "@/test/privacy-sentinels";
import { resetCoreTables } from "@/test/db";

const PUBLISHED_AT = 1_700_000_000;
const OBSERVED_UNTIL = 1_700_001_000;

describe("simulation calibration (slice 3.4)", () => {
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

  function insertContentPost(
    contentItemId: string,
    publishedAt: number | null,
    platformAccountId = seedPlatformAccount(),
  ) {
    const postId = nanoid();
    db.insert(contentPosts)
      .values({
        id: postId,
        contentItemId,
        platformAccountId,
        publishedAt,
        status: publishedAt === null ? "imported" : "published",
      })
      .run();
    return postId;
  }

  function insertSnapshot(
    contentPostId: string,
    metrics: Partial<Record<"likes" | "comments" | "shares", number>>,
    snapshotAt: number,
  ) {
    db.insert(engagementMetrics)
      .values({
        id: nanoid(),
        contentPostId,
        snapshotAt,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        impressions: 0,
        clicks: 0,
        bookmarks: 0,
        quotes: 0,
        retweets: 0,
      })
      .run();
  }

  function seedCompletedPublishedRun(predictedMetrics: Record<string, number> = { likes: 20 }) {
    const contact = createContact({ name: "Calib Agent", platform: "x", platformUserId: "cal-1" });
    const launch = upsertLaunch({ name: "Calib Launch", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "Wind tunnel copy" });
    const { run, agents } = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    const predictedScore = scoreEngagementMetrics({
      likes: predictedMetrics.likes ?? 0,
      comments: predictedMetrics.comments ?? 0,
      shares: predictedMetrics.shares ?? 0,
      impressions: predictedMetrics.impressions ?? 0,
      clicks: predictedMetrics.clicks ?? 0,
      bookmarks: predictedMetrics.bookmarks ?? 0,
      quotes: predictedMetrics.quotes ?? 0,
      retweets: predictedMetrics.retweets ?? 0,
    });
    recordSimulationAgentResults(run.id, [
      { agentId: agents[0]!.id, engagementScore: 50, outcome: "like" },
    ]);
    completeSimulationRun(run.id, {
      predictedScore,
      predictionConfidence: 0.5,
      predictedMetrics,
    });
    const published = publishVariant(variant.id, { platform: "x", publishedAt: PUBLISHED_AT });
    return { contact, launch, variant: published, run };
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

  it("listCalibrationsForRun orders by observedUntil desc and matches latest helper", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    insertSnapshot(postId, { likes: 4 }, PUBLISHED_AT + 100);

    calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });
    calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL + 500 });

    const rows = listCalibrationsForRun(run.id);
    expect(rows.length).toBe(2);
    expect(rows[0]!.observedUntil).toBeGreaterThan(rows[1]!.observedUntil);
    expect(rows[0]).toEqual(getLatestCalibrationForRun(run.id));
  });

  it("prefers snapshot metrics over shared events (no double-count)", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    insertSnapshot(postId, { likes: 10 }, PUBLISHED_AT + 100);
    seedLikeEvents(postId, 5, PUBLISHED_AT + 200);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });

    expect(calibration.actualMetrics).toContain('"likes":10');
    expect(calibration.actualScore).toBe(scoreEngagementMetrics({ likes: 10, comments: 0, shares: 0, impressions: 0, clicks: 0, bookmarks: 0, quotes: 0, retweets: 0 }));
    const payload = JSON.parse(calibration.calibration ?? "{}") as {
      provenanceSummary: { provenance: { likes: string } }[];
    };
    expect(payload.provenanceSummary[0]?.provenance.likes).toBe("snapshot");
  });

  it("falls back to shared events when no in-window snapshot exists", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    seedLikeEvents(postId, 3, PUBLISHED_AT + 50);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });

    expect(calibration.actualMetrics).toContain('"likes":3');
    const payload = JSON.parse(calibration.calibration ?? "{}") as {
      provenanceSummary: { provenance: { likes: string } }[];
    };
    expect(payload.provenanceSummary[0]?.provenance.likes).toBe("events");
  });

  it("aggregates actuals across multiple eligible posts", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const platformAccountId = seedPlatformAccount();
    const postA = insertContentPost(variant.contentItemId!, PUBLISHED_AT, platformAccountId);
    const postB = insertContentPost(
      variant.contentItemId!,
      PUBLISHED_AT + 100,
      platformAccountId,
    );
    insertSnapshot(postA, { likes: 5 }, PUBLISHED_AT + 50);
    insertSnapshot(postB, { likes: 7 }, PUBLISHED_AT + 150);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });

    expect(calibration.actualMetrics).toContain('"likes":12');
    expect(calibration.contentPostId).toBeNull();
    expect(calibration.observedFrom).toBe(PUBLISHED_AT);
    const payload = JSON.parse(calibration.calibration ?? "{}") as { posts: unknown[] };
    expect(payload.posts).toHaveLength(2);
  });

  it("throws CalibrationSourceError when variant is published without eligible posts", () => {
    const { run } = seedCompletedPublishedRun();

    expect(() => calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL })).toThrow(
      CalibrationSourceError,
    );
    expect(db.select().from(simulationCalibrations).all()).toHaveLength(0);
  });

  it("excludes posts with NULL published_at and records them as skipped", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const platformAccountId = seedPlatformAccount();
    const eligiblePost = insertContentPost(variant.contentItemId!, PUBLISHED_AT, platformAccountId);
    insertContentPost(variant.contentItemId!, null, platformAccountId);
    insertSnapshot(eligiblePost, { likes: 4 }, PUBLISHED_AT + 10);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });

    expect(calibration.actualMetrics).toContain('"likes":4');
    const payload = JSON.parse(calibration.calibration ?? "{}") as {
      skippedPosts: { reason: string }[];
    };
    expect(payload.skippedPosts).toHaveLength(1);
    expect(payload.skippedPosts[0]?.reason).toBe("null_published_at");
  });

  it("§8.5(3.4): local_only events do not change derived calibration values", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    seedLikeEvents(postId, 2, PUBLISHED_AT + 50, "shared");

    const before = computeCalibrationActualsForRun(run, OBSERVED_UNTIL);
    seedLikeEvents(postId, 50, PUBLISHED_AT + 60, "local_only");
    const after = computeCalibrationActualsForRun(run, OBSERVED_UNTIL);

    expect(after).toEqual(before);
    expect(after.actualMetrics.likes).toBe(2);
  });

  it("labels zero-valued snapshot counters as snapshot provenance", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    insertSnapshot(postId, { likes: 0 }, PUBLISHED_AT + 100);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });
    const payload = JSON.parse(calibration.calibration ?? "{}") as {
      provenanceSummary: { provenance: { likes: string } }[];
    };
    expect(payload.provenanceSummary[0]?.provenance.likes).toBe("snapshot");
  });

  it("enforces observed_until on shared events and snapshots", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    seedLikeEvents(postId, 2, OBSERVED_UNTIL + 1, "shared");
    insertSnapshot(postId, { likes: 99 }, OBSERVED_UNTIL + 1);

    const calibration = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });
    expect(calibration.actualMetrics).toContain('"likes":0');
  });

  it("§8.5(3.4): local_only content activities do not change derived calibration values", () => {
    const { variant, run } = seedCompletedPublishedRun();
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    seedLikeEvents(postId, 2, PUBLISHED_AT + 50, "shared");

    const before = computeCalibrationActualsForRun(run, OBSERVED_UNTIL);
    db.insert(contentActivities)
      .values({
        id: nanoid(),
        activityType: "like",
        direction: "outbound",
        occurredAt: PUBLISHED_AT + 60,
        scope: "local_only",
        source: "agent",
        contentPostId: postId,
        platform: "x",
      })
      .run();
    const after = computeCalibrationActualsForRun(run, OBSERVED_UNTIL);

    expect(after).toEqual(before);
  });

  it("persists metric comparisons and workflow provenance from the calibration sweep", () => {
    const { variant, run } = seedCompletedPublishedRun({ likes: 10 });
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    insertSnapshot(postId, { likes: 6 }, PUBLISHED_AT + 20);

    const report = runSimulationCalibrationSweep({ observedUntil: OBSERVED_UNTIL });
    const calibration = getLatestCalibrationForRun(run.id)!;

    expect(report.runsCalibrated).toBe(1);
    expect(calibration.source).toBe("workflow");
    expect(calibration.workflowRunId).toBe(report.workflowRunId);
    expect(
      db.select().from(workflowRuns).where(eq(workflowRuns.id, report.workflowRunId)).get()
        ?.workflowType,
    ).toBe("calibrate");

    const serialized = JSON.parse(calibration.calibration ?? "{}") as {
      metricComparisons: { likes: { predicted: number; actual: number; error: number } };
      predictedScore: number;
    };
    expect(serialized.metricComparisons.likes).toEqual({
      predicted: 10,
      actual: 6,
      error: -4,
    });
    expect(serialized.predictedScore).toBe(20);
    expect(calibration.scoreError).toBe(12 - 20);
  });

  it("calibrates every completed run on a published variant, not only the latest", () => {
    const contact = createContact({ name: "Sweep Agent", platform: "x", platformUserId: "cal-sweep" });
    const launch = upsertLaunch({ name: "Sweep Launch", primaryPlatform: "x" });
    const variant = upsertVariant({ launchId: launch.id, body: "copy" });

    const first = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(first.run.id, [
      { agentId: first.agents[0]!.id, engagementScore: 40, outcome: "like" },
    ]);
    completeSimulationRun(first.run.id, {
      predictedScore: 20,
      predictionConfidence: 0.5,
      predictedMetrics: { likes: 10 },
    });

    const second = createAndStartSimulationRun({
      variantId: variant.id,
      populationSpec: { contactIds: [contact.id] },
    });
    recordSimulationAgentResults(second.run.id, [
      { agentId: second.agents[0]!.id, engagementScore: 60, outcome: "like" },
    ]);
    completeSimulationRun(second.run.id, {
      predictedScore: 30,
      predictionConfidence: 0.6,
      predictedMetrics: { likes: 15 },
    });

    const published = publishVariant(variant.id, { platform: "x", publishedAt: PUBLISHED_AT });
    insertContentPost(published.contentItemId!, PUBLISHED_AT);

    const report = runSimulationCalibrationSweep({ observedUntil: OBSERVED_UNTIL });

    expect(report.runsCalibrated).toBe(2);
    expect(getLatestCalibrationForRun(first.run.id)).toBeTruthy();
    expect(getLatestCalibrationForRun(second.run.id)).toBeTruthy();
  });

  it("§8.5(3.4): persisted calibration values are invariant to local_only evidence", () => {
    const { variant, run } = seedCompletedPublishedRun({ likes: 2 });
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    seedLikeEvents(postId, 2, PUBLISHED_AT + 50, "shared");

    const first = calibrateSimulationRun(run.id, { observedUntil: OBSERVED_UNTIL });
    const persisted = {
      actualScore: first.actualScore,
      actualMetrics: first.actualMetrics,
      scoreError: first.scoreError,
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

    const second = calibrateSimulationRun(run.id, {
      observedUntil: OBSERVED_UNTIL + 500,
      provenance: { source: "agent" },
    });

    expect(second.actualScore).toBe(persisted.actualScore);
    expect(second.actualMetrics).toBe(persisted.actualMetrics);
    expect(second.scoreError).toBe(persisted.scoreError);
  });

  it("scheduler dispatches the calibration sweep maintenance job", () => {
    const { variant, run } = seedCompletedPublishedRun({ likes: 4 });
    insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    const jobId = nanoid();
    db.insert(scheduledJobs)
      .values({
        id: jobId,
        jobType: SIMULATION_CALIBRATION_SWEEP_JOB_TYPE,
        status: "pending",
        runAt: OBSERVED_UNTIL - 10,
        enabled: 1,
        payload: JSON.stringify({ observedUntil: OBSERVED_UNTIL }),
      })
      .run();

    executeScheduledJob(jobId);

    expect(getScheduledJob(jobId)?.status).toBe("completed");
    expect(getLatestCalibrationForRun(run.id)?.source).toBe("workflow");
  });

  it("calibrate_simulation_run tool persists and query_simulations can surface latest calibration", async () => {
    const { variant, run } = seedCompletedPublishedRun({ likes: 10 });
    const postId = insertContentPost(variant.contentItemId!, PUBLISHED_AT);
    insertSnapshot(postId, { likes: 6 }, PUBLISHED_AT + 20);

    const calibrated = await invokeAgentTool("calibrate_simulation_run", {
      runId: run.id,
      observedUntil: OBSERVED_UNTIL,
    });
    assertNoPrivacySentinels(calibrated);
    expect((calibrated as { calibration: { scoreError: number; source: string; workflowRunId: null } }).calibration).toMatchObject({
      scoreError: 12 - 20,
      source: "agent",
      workflowRunId: null,
    });

    const queried = await invokeAgentTool("query_simulations", {
      variantId: variant.id,
      includeCalibrations: true,
    });
    const runs = (queried as { runs: { latestCalibration?: { simulationRunId: string } }[] }).runs;
    expect(runs[0]?.latestCalibration?.simulationRunId).toBe(run.id);
    expect(getLatestCalibrationForRun(run.id)?.id).toBe(
      (calibrated as { calibration: { id: string } }).calibration.id,
    );
    expect(getSimulationRun(run.id, { includeCalibration: true })?.latestCalibration?.actualScore).toBe(
      scoreEngagementMetrics({
        likes: 6,
        comments: 0,
        shares: 0,
        impressions: 0,
        clicks: 0,
        bookmarks: 0,
        quotes: 0,
        retweets: 0,
      }),
    );
  });
});
