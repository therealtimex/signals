/**
 * Analytics query functions — all sync (better-sqlite3).
 * Each accepts `since` as a Unix timestamp (seconds) for time filtering.
 * Uses raw SQL via db.$client for complex aggregations.
 */

import { db } from "@/lib/db/client";

// Access the underlying better-sqlite3 Database instance
const raw = db.$client;

// ── Overview Queries ──────────────────────────────

/** Contact growth over time, grouped by day. */
export function getContactGrowth(since: number): { date: string; count: number }[] {
  return raw
    .prepare(
      `SELECT date(created_at, 'unixepoch') AS date, COUNT(*) AS count
       FROM contacts
       WHERE created_at >= ?
       GROUP BY date(created_at, 'unixepoch')
       ORDER BY date ASC`
    )
    .all(since) as { date: string; count: number }[];
}

/** Enrichment score distribution in 5 buckets. */
export function getEnrichmentDistribution(): { bucket: string; count: number }[] {
  return raw
    .prepare(
      `SELECT
         CASE
           WHEN enrichment_score <= 20 THEN '0-20'
           WHEN enrichment_score <= 40 THEN '21-40'
           WHEN enrichment_score <= 60 THEN '41-60'
           WHEN enrichment_score <= 80 THEN '61-80'
           ELSE '81-100'
         END AS bucket,
         COUNT(*) AS count
       FROM contacts
       GROUP BY bucket
       ORDER BY MIN(enrichment_score) ASC`
    )
    .all() as { bucket: string; count: number }[];
}

/** Contacts by platform (from identities table). */
export function getPlatformMix(): { platform: string; count: number }[] {
  return raw
    .prepare(
      `SELECT platform, COUNT(DISTINCT contact_id) AS count
       FROM contact_identities
       GROUP BY platform
       ORDER BY count DESC`
    )
    .all() as { platform: string; count: number }[];
}

// ── Agent Cost Queries ────────────────────────────

export interface AgentCostSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRuns: number;
}

/** Aggregate cost/token totals for agent-type workflow runs. */
export function getAgentCostSummary(since: number): AgentCostSummary {
  const row = raw
    .prepare(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS totalCost,
         COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
         COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
         COUNT(*) AS totalRuns
       FROM workflow_runs
       WHERE model IS NOT NULL AND created_at >= ?`
    )
    .get(since) as AgentCostSummary | undefined;
  return row ?? { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRuns: 0 };
}

/** Agent cost over time, grouped by day. */
export function getAgentCostOverTime(since: number): { date: string; cost: number; runs: number }[] {
  return raw
    .prepare(
      `SELECT
         date(COALESCE(completed_at, created_at), 'unixepoch') AS date,
         SUM(cost_usd) AS cost,
         COUNT(*) AS runs
       FROM workflow_runs
       WHERE model IS NOT NULL AND created_at >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(since) as { date: string; cost: number; runs: number }[];
}

/** Cost breakdown by workflow type. */
export function getCostByWorkflowType(since: number): { workflowType: string; cost: number; runs: number }[] {
  return raw
    .prepare(
      `SELECT
         workflow_type AS workflowType,
         SUM(cost_usd) AS cost,
         COUNT(*) AS runs
       FROM workflow_runs
       WHERE model IS NOT NULL AND created_at >= ?
       GROUP BY workflow_type
       ORDER BY cost DESC`
    )
    .all(since) as { workflowType: string; cost: number; runs: number }[];
}

/** Token usage breakdown by model. */
export function getTokenUsageByModel(since: number): { model: string; inputTokens: number; outputTokens: number }[] {
  return raw
    .prepare(
      `SELECT
         model,
         SUM(input_tokens) AS inputTokens,
         SUM(output_tokens) AS outputTokens
       FROM workflow_runs
       WHERE model IS NOT NULL AND created_at >= ?
       GROUP BY model
       ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`
    )
    .all(since) as { model: string; inputTokens: number; outputTokens: number }[];
}

/** Cost per template with averages. */
export function getCostPerTemplate(since: number): {
  templateId: string;
  templateName: string;
  totalCost: number;
  runCount: number;
  avgCost: number;
}[] {
  return raw
    .prepare(
      `SELECT
         wr.template_id AS templateId,
         COALESCE(wt.name, 'Ad-hoc') AS templateName,
         SUM(wr.cost_usd) AS totalCost,
         COUNT(*) AS runCount,
         AVG(wr.cost_usd) AS avgCost
       FROM workflow_runs wr
       LEFT JOIN workflow_templates wt ON wt.id = wr.template_id
       WHERE wr.model IS NOT NULL AND wr.created_at >= ?
       GROUP BY wr.template_id
       ORDER BY totalCost DESC`
    )
    .all(since) as {
    templateId: string;
    templateName: string;
    totalCost: number;
    runCount: number;
    avgCost: number;
  }[];
}

/** Workflow success/failure rate by type. */
export function getWorkflowSuccessRate(since: number): {
  workflowType: string;
  completed: number;
  failed: number;
  total: number;
}[] {
  return raw
    .prepare(
      `SELECT
         workflow_type AS workflowType,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         COUNT(*) AS total
       FROM workflow_runs
       WHERE created_at >= ?
       GROUP BY workflow_type
       ORDER BY total DESC`
    )
    .all(since) as {
    workflowType: string;
    completed: number;
    failed: number;
    total: number;
  }[];
}

/** Average duration by workflow type (seconds). */
export function getAvgDurationByType(since: number): { workflowType: string; avgDurationSeconds: number }[] {
  return raw
    .prepare(
      `SELECT
         workflow_type AS workflowType,
         AVG(completed_at - started_at) AS avgDurationSeconds
       FROM workflow_runs
       WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND created_at >= ?
       GROUP BY workflow_type
       ORDER BY avgDurationSeconds DESC`
    )
    .all(since) as { workflowType: string; avgDurationSeconds: number }[];
}

// ── Engagement Queries ────────────────────────────

/** Engagement volume over time, grouped by day + type (interactions ∪ content_activities). */
export function getEngagementVolume(since: number): { date: string; type: string; count: number }[] {
  return raw
    .prepare(
      `SELECT
         date(occurred_at, 'unixepoch') AS date,
         event_type AS type,
         COUNT(*) AS count
       FROM (
         SELECT occurred_at, interaction_type AS event_type
         FROM interactions
         WHERE occurred_at >= ?
         UNION ALL
         SELECT occurred_at, activity_type AS event_type
         FROM content_activities
         WHERE occurred_at >= ?
       )
       GROUP BY date, event_type
       ORDER BY date ASC`
    )
    .all(since, since) as { date: string; type: string; count: number }[];
}

/** Inbound vs outbound events, grouped by week (interactions ∪ content_activities). */
export function getEngagementDirectionSummary(since: number): { period: string; inbound: number; outbound: number }[] {
  return raw
    .prepare(
      `SELECT
         strftime('%Y-W%W', occurred_at, 'unixepoch') AS period,
         SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
         SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound
       FROM (
         SELECT occurred_at, direction FROM interactions WHERE occurred_at >= ?
         UNION ALL
         SELECT occurred_at, direction FROM content_activities WHERE occurred_at >= ?
       )
       GROUP BY period
       ORDER BY period ASC`
    )
    .all(since, since) as { period: string; inbound: number; outbound: number }[];
}

/** Event type breakdown (interactions ∪ content_activities). */
export function getEngagementTypeBreakdown(since: number): { type: string; count: number }[] {
  return raw
    .prepare(
      `SELECT event_type AS type, COUNT(*) AS count
       FROM (
         SELECT interaction_type AS event_type FROM interactions WHERE occurred_at >= ?
         UNION ALL
         SELECT activity_type AS event_type FROM content_activities WHERE occurred_at >= ?
       )
       GROUP BY event_type
       ORDER BY count DESC`
    )
    .all(since, since) as { type: string; count: number }[];
}

/** Top engaged contacts by interaction count (relationship events only). */
export function getTopEngagedContacts(since: number, limit = 10): {
  contactId: string;
  name: string;
  count: number;
}[] {
  return raw
    .prepare(
      `SELECT
         i.contact_id AS contactId,
         c.name,
         COUNT(*) AS count
       FROM interactions i
       JOIN contacts c ON c.id = i.contact_id
       WHERE i.occurred_at >= ?
       GROUP BY i.contact_id
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(since, limit) as { contactId: string; name: string; count: number }[];
}

// ── Content Queries ───────────────────────────────

/** Content published over time, grouped by day. */
export function getContentPublishedOverTime(since: number): { date: string; count: number }[] {
  return raw
    .prepare(
      `SELECT
         date(published_at, 'unixepoch') AS date,
         COUNT(*) AS count
       FROM content_posts
       WHERE published_at IS NOT NULL AND published_at >= ?
       GROUP BY date(published_at, 'unixepoch')
       ORDER BY date ASC`
    )
    .all(since) as { date: string; count: number }[];
}

export type TopPostRow = {
  title: string | null;
  /** Platform the post was published through, or null when the account is unknown. */
  platform: string | null;
  platformUrl: string | null;
  likes: number;
  comments: number;
  shares: number;
  retweets: number;
  quotes: number;
  impressions: number;
  total: number;
};

/**
 * Top posts by total engagement, ranked within each platform.
 *
 * Platforms report different counters, so callers render one section per platform rather than a
 * single mixed table — `limit` is per platform, not overall.
 */
export function getTopPostsByEngagement(limit = 10): TopPostRow[] {
  return raw
    .prepare(
      `WITH latest AS (
         SELECT
           ci.title AS title,
           pa.platform AS platform,
           cp.platform_url AS platformUrl,
           em.likes AS likes,
           em.comments AS comments,
           em.shares AS shares,
           em.retweets AS retweets,
           em.quotes AS quotes,
           em.impressions AS impressions,
           (em.likes + em.impressions + em.retweets + em.comments + em.shares) AS total,
           ROW_NUMBER() OVER (
             PARTITION BY em.content_post_id ORDER BY em.snapshot_at DESC
           ) AS snapshotRank
         FROM engagement_metrics em
         JOIN content_posts cp ON cp.id = em.content_post_id
         JOIN content_items ci ON ci.id = cp.content_item_id
         LEFT JOIN platform_accounts pa ON pa.id = cp.platform_account_id
       ),
       ranked AS (
         SELECT
           latest.*,
           ROW_NUMBER() OVER (PARTITION BY platform ORDER BY total DESC) AS platformRank
         FROM latest
         WHERE snapshotRank = 1
       )
       SELECT title, platform, platformUrl, likes, comments, shares, retweets, quotes,
              impressions, total
       FROM ranked
       WHERE platformRank <= ?
       ORDER BY platform IS NULL, platform ASC, total DESC`
    )
    .all(limit) as TopPostRow[];
}

/** Content type distribution. */
export function getContentTypeDistribution(): { contentType: string; count: number }[] {
  return raw
    .prepare(
      `SELECT content_type AS contentType, COUNT(*) AS count
       FROM content_items
       GROUP BY content_type
       ORDER BY count DESC`
    )
    .all() as { contentType: string; count: number }[];
}

export type PlatformEngagementAverages = {
  /** Platform the snapshots belong to, or null when the account is unknown. */
  platform: string | null;
  posts: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number;
  avgRetweets: number;
  avgQuotes: number;
  avgImpressions: number;
};

/**
 * Average engagement per platform.
 *
 * Averaging across platforms would mix counters that do not exist on every network (an all-zero
 * "Avg Retweets" for a Facebook-only account reads as a data bug), so the grouping is the point.
 */
export function getAverageEngagementMetrics(since: number): PlatformEngagementAverages[] {
  return raw
    .prepare(
      `SELECT
         pa.platform AS platform,
         COUNT(*) AS posts,
         COALESCE(AVG(em.likes), 0) AS avgLikes,
         COALESCE(AVG(em.comments), 0) AS avgComments,
         COALESCE(AVG(em.shares), 0) AS avgShares,
         COALESCE(AVG(em.retweets), 0) AS avgRetweets,
         COALESCE(AVG(em.quotes), 0) AS avgQuotes,
         COALESCE(AVG(em.impressions), 0) AS avgImpressions
       FROM engagement_metrics em
       JOIN content_posts cp ON cp.id = em.content_post_id
       LEFT JOIN platform_accounts pa ON pa.id = cp.platform_account_id
       WHERE em.snapshot_at >= ?
       GROUP BY pa.platform
       ORDER BY platform IS NULL, platform ASC`
    )
    .all(since) as PlatformEngagementAverages[];
}

// ── Sync Health Queries ───────────────────────────

/** Platform health status combining accounts + sync cursors. */
export function getSyncHealthByPlatform(): {
  platform: string;
  status: string;
  lastSyncedAt: number | null;
  totalSynced: number;
  accountStatus: string;
}[] {
  return raw
    .prepare(
      `SELECT
         pa.platform,
         COALESCE(sc.sync_status, 'idle') AS status,
         pa.last_synced_at AS lastSyncedAt,
         COALESCE(SUM(sc.total_items_synced), 0) AS totalSynced,
         pa.status AS accountStatus
       FROM platform_accounts pa
       LEFT JOIN sync_cursors sc ON sc.platform_account_id = pa.id
       GROUP BY pa.id
       ORDER BY pa.platform ASC`
    )
    .all() as {
    platform: string;
    status: string;
    lastSyncedAt: number | null;
    totalSynced: number;
    accountStatus: string;
  }[];
}

/** Sync workflow activity over time. */
export function getSyncActivityOverTime(since: number): {
  date: string;
  count: number;
  successCount: number;
  failCount: number;
}[] {
  return raw
    .prepare(
      `SELECT
         date(COALESCE(completed_at, created_at), 'unixepoch') AS date,
         COUNT(*) AS count,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successCount,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failCount
       FROM workflow_runs
       WHERE workflow_type = 'sync' AND created_at >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(since) as {
    date: string;
    count: number;
    successCount: number;
    failCount: number;
  }[];
}

/** Recent sync errors. */
export function getRecentSyncErrors(limit = 10): {
  runId: string;
  errorItems: number;
  errors: string;
  completedAt: number | null;
}[] {
  return raw
    .prepare(
      `SELECT
         id AS runId,
         error_items AS errorItems,
         errors,
         completed_at AS completedAt
       FROM workflow_runs
       WHERE workflow_type = 'sync' AND status = 'failed'
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as {
    runId: string;
    errorItems: number;
    errors: string;
    completedAt: number | null;
  }[];
}
