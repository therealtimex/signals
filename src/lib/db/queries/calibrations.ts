import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  contentPosts,
  engagementMetrics,
  simulationCalibrations,
  simulationRuns,
  variants,
} from "@/lib/db/schema";
import { listSharedEngagementEventsByContentPost } from "@/lib/db/queries/engagement-events";
import { getVariantById } from "@/lib/db/queries/variants";
import { CalibrationSourceError } from "@/lib/db/queries/simulation-errors";
import {
  ENGAGEMENT_METRIC_KEYS,
  type EngagementMetricKey,
} from "@/lib/db/simulation-validation";
import {
  SIMULATION_SCORING_RECIPE_VERSION,
  type EngagementMetricsRecord,
  emptyEngagementMetrics,
  scoreEngagementMetrics,
  sumEngagementMetrics,
} from "@/lib/db/simulation-scoring";
import type { SimulationCalibration, SimulationRun } from "@/lib/db/types";

const EVENT_TYPE_TO_METRIC: Record<string, keyof EngagementMetricsRecord> = {
  like: "likes",
  comment: "comments",
  share: "shares",
  retweet: "retweets",
  quote: "quotes",
  bookmark: "bookmarks",
  impression: "impressions",
  click: "clicks",
  reply: "comments",
};

export type CalibrateSimulationRunInput = {
  observedUntil?: number;
  workflowRunId?: string | null;
  source?: "agent" | "workflow";
};

type MetricProvenance = Record<EngagementMetricKey, "snapshot" | "events" | "none">;

function metricsFromSnapshot(row: typeof engagementMetrics.$inferSelect): EngagementMetricsRecord {
  return {
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    impressions: row.impressions,
    clicks: row.clicks,
    bookmarks: row.bookmarks,
    quotes: row.quotes,
    retweets: row.retweets,
  };
}

function metricsFromSharedEvents(
  contentPostId: string,
  windowStart: number,
  windowEnd: number,
): EngagementMetricsRecord {
  const metrics = emptyEngagementMetrics();
  for (const event of listSharedEngagementEventsByContentPost(contentPostId)) {
    if (event.occurredAt < windowStart || event.occurredAt > windowEnd) continue;
    const key = EVENT_TYPE_TO_METRIC[event.eventType];
    if (!key) continue;
    metrics[key] += 1;
  }
  return metrics;
}

function actualMetricsForPost(
  contentPostId: string,
  windowStart: number,
  windowEnd: number,
): { metrics: EngagementMetricsRecord; provenance: MetricProvenance } {
  const provenance = emptyEngagementMetrics() as unknown as MetricProvenance;
  for (const key of ENGAGEMENT_METRIC_KEYS) {
    provenance[key] = "none";
  }

  const snapshot = db
    .select()
    .from(engagementMetrics)
    .where(
      and(
        eq(engagementMetrics.contentPostId, contentPostId),
        lte(engagementMetrics.snapshotAt, windowEnd),
        gte(engagementMetrics.snapshotAt, windowStart),
      ),
    )
    .orderBy(desc(engagementMetrics.snapshotAt))
    .get();

  const metrics = emptyEngagementMetrics();
  if (snapshot) {
    const snapshotMetrics = metricsFromSnapshot(snapshot);
    for (const key of ENGAGEMENT_METRIC_KEYS) {
      metrics[key] = snapshotMetrics[key];
      provenance[key] = snapshotMetrics[key] > 0 ? "snapshot" : "none";
    }
    return { metrics, provenance };
  }

  const eventMetrics = metricsFromSharedEvents(contentPostId, windowStart, windowEnd);
  for (const key of ENGAGEMENT_METRIC_KEYS) {
    if (eventMetrics[key] > 0) {
      metrics[key] = eventMetrics[key];
      provenance[key] = "events";
    }
  }
  return { metrics, provenance };
}

export function getLatestCalibrationForRun(
  runId: string,
): SimulationCalibration | undefined {
  return db
    .select()
    .from(simulationCalibrations)
    .where(eq(simulationCalibrations.simulationRunId, runId))
    .orderBy(desc(simulationCalibrations.observedUntil), desc(simulationCalibrations.computedAt))
    .get();
}

export function calibrateSimulationRun(
  runId: string,
  input: CalibrateSimulationRunInput = {},
): SimulationCalibration {
  const run = db.select().from(simulationRuns).where(eq(simulationRuns.id, runId)).get();
  if (!run) {
    throw new Error(`Simulation run not found: ${runId}`);
  }
  if (run.status !== "completed") {
    throw new Error(`Simulation run must be completed to calibrate — current status is '${run.status}'`);
  }

  const variant = getVariantById(run.variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${run.variantId}`);
  }
  if (variant.status !== "published") {
    throw new CalibrationSourceError(
      "Cannot calibrate a simulation run until its variant is published",
    );
  }
  if (!variant.contentItemId) {
    throw new CalibrationSourceError(
      "Variant is published but has no linked content item — publish through publishVariant first",
    );
  }

  const observedUntil = input.observedUntil ?? Math.floor(Date.now() / 1000);
  const allPosts = db
    .select()
    .from(contentPosts)
    .where(eq(contentPosts.contentItemId, variant.contentItemId))
    .all();

  const skippedPosts = allPosts
    .filter((post) => post.publishedAt === null)
    .map((post) => ({ contentPostId: post.id, reason: "null_published_at" as const }));

  const eligiblePosts = allPosts.filter(
    (post) => post.publishedAt !== null && post.publishedAt <= observedUntil,
  );

  if (eligiblePosts.length === 0) {
    throw new CalibrationSourceError(
      "Variant is published but has no platform post with a publish timestamp — sync the post or calibrate later",
    );
  }

  const postBreakdown: {
    contentPostId: string;
    observedFrom: number;
    observedUntil: number;
    metrics: EngagementMetricsRecord;
    provenance: MetricProvenance;
  }[] = [];

  let actualMetrics = emptyEngagementMetrics();
  let observedFrom = eligiblePosts[0]!.publishedAt!;

  for (const post of eligiblePosts) {
    const windowStart = post.publishedAt!;
    observedFrom = Math.min(observedFrom, windowStart);
    const { metrics, provenance } = actualMetricsForPost(post.id, windowStart, observedUntil);
    postBreakdown.push({
      contentPostId: post.id,
      observedFrom: windowStart,
      observedUntil,
      metrics,
      provenance,
    });
    actualMetrics = sumEngagementMetrics(actualMetrics, metrics);
  }

  const actualScore = scoreEngagementMetrics(actualMetrics);
  const predictedScore = run.predictedScore ?? 0;
  const scoreError = actualScore - predictedScore;
  const computedAt = Math.floor(Date.now() / 1000);
  const calibrationId = nanoid();

  const calibrationPayload = {
    scoringRecipeVersion: SIMULATION_SCORING_RECIPE_VERSION,
    posts: postBreakdown,
    skippedPosts,
    provenanceSummary: postBreakdown.map((post) => ({
      contentPostId: post.contentPostId,
      provenance: post.provenance,
    })),
  };

  db.insert(simulationCalibrations)
    .values({
      id: calibrationId,
      simulationRunId: run.id,
      variantId: variant.id,
      contentItemId: variant.contentItemId,
      contentPostId: eligiblePosts.length === 1 ? eligiblePosts[0]!.id : null,
      observedFrom,
      observedUntil,
      actualScore,
      actualMetrics: JSON.stringify(actualMetrics),
      scoreError,
      calibration: JSON.stringify(calibrationPayload),
      workflowRunId: input.workflowRunId ?? null,
      source: input.source ?? "agent",
      computedAt,
    })
    .run();

  return db.select().from(simulationCalibrations).where(eq(simulationCalibrations.id, calibrationId)).get()!;
}

export function serializeCalibration(row: SimulationCalibration) {
  return {
    id: row.id,
    simulationRunId: row.simulationRunId,
    variantId: row.variantId,
    contentItemId: row.contentItemId,
    contentPostId: row.contentPostId,
    observedFrom: row.observedFrom,
    observedUntil: row.observedUntil,
    actualScore: row.actualScore,
    actualMetrics: JSON.parse(row.actualMetrics ?? "{}") as Record<string, number>,
    scoreError: row.scoreError,
    calibration: JSON.parse(row.calibration ?? "{}") as Record<string, unknown>,
    source: row.source,
    computedAt: row.computedAt,
  };
}

/** Test helper — compute actuals without persisting. */
export function computeCalibrationActualsForRun(
  run: SimulationRun,
  observedUntil: number,
): { actualMetrics: EngagementMetricsRecord; actualScore: number } {
  const variant = getVariantById(run.variantId);
  if (!variant?.contentItemId) {
    throw new CalibrationSourceError("Variant has no content item");
  }
  const eligiblePosts = db
    .select()
    .from(contentPosts)
    .where(
      and(
        eq(contentPosts.contentItemId, variant.contentItemId),
        isNotNull(contentPosts.publishedAt),
        lte(contentPosts.publishedAt, observedUntil),
      ),
    )
    .all();

  let actualMetrics = emptyEngagementMetrics();
  for (const post of eligiblePosts) {
    const { metrics } = actualMetricsForPost(post.id, post.publishedAt!, observedUntil);
    actualMetrics = sumEngagementMetrics(actualMetrics, metrics);
  }
  return { actualMetrics, actualScore: scoreEngagementMetrics(actualMetrics) };
}
