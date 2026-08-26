import { createHash } from "node:crypto";
import {
  NETWORK_SNOWBALL_DISPATCH_THREAD_SLUG,
  resolveNetworkSnowballDispatchThread,
  resolveSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";
import {
  SNOWBALL_SEED_CLAIM_TTL_MS,
  claimSeedWithSchedule,
  confirmSeed,
  pruneSnowballSeedLedger,
  releaseSeedClaim,
} from "@/lib/db/queries/snowball-seed-ledger";
import { resolveRtxApiBase, type EnvLike } from "@/lib/rtx/env";
import { NETWORK_SNOWBALL_TEMPLATE_NAME } from "@/lib/workflows/network-snowball";
import type { SnowballSeedScoutConfig } from "@/lib/workflows/snowball-seed-scout";

export interface EnqueueSnowballSeedInput {
  url: string;
  platform?: string | null;
  producerRunId?: string | null;
  scheduledAt?: string | null;
}

export type EnqueueSnowballSeedsResult =
  | {
      success: true;
      queued: Array<{ url: string; calendarEventUuid: string | null; scheduledAt: string }>;
      /** Seeds intentionally not queued (blank URL) — not an error. */
      skipped: string[];
      /** Seeds already queued inside the dedupe window — not an error. */
      deduped: string[];
      /** Seeds the calendar API rejected; the caller must surface these as failures. */
      failed: Array<{ url: string; reason: string }>;
      /** Seeds left unattempted because the batch ran out of time. */
      deferred: string[];
    }
  | { success: false; error: string };

/**
 * Per-seed calendar POST budget. Must stay well under
 * SNOWBALL_SEED_CLAIM_TTL_MS so a request cannot outlive its own claim.
 */
const CALENDAR_POST_TIMEOUT_MS = 60_000;

/**
 * Whole-batch budget. `enqueue.sh` gives this route 120s, so a sequential batch
 * of slow POSTs must stop short of that: blowing the caller's deadline makes the
 * scout retry seeds that may already be on the calendar.
 */
const ENQUEUE_BATCH_BUDGET_MS = 90_000;

/** Below this there is not enough budget left to be worth starting a POST. */
const MIN_POST_BUDGET_MS = 5_000;

/**
 * How many calendar POSTs may be in flight at once.
 *
 * Sequential posting made a slow calendar defer most of the batch: 20 seeds at a
 * 60s ceiling cannot fit the caller's 120s deadline. Running a few concurrently
 * keeps wall time near a single request while still bounding the burst — the
 * route accepts a caller-supplied list, so this must not scale with input size.
 */
const CALENDAR_POST_CONCURRENCY = 4;

function hashUrl(url: string): string {
  return createHash("sha256").update(url.trim()).digest("hex");
}

/** Calendar titles must stay readable; never embed a truncated post URL (breaks Facebook pfbid links). */
export function formatSnowballCalendarTitle(url: string): string {
  const prefix = "[Signals] Snowball";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${prefix}: ${host}/${parts.slice(0, 2).join("/")}`;
    }
    return `${prefix}: ${host}${parsed.pathname}`;
  } catch {
    return prefix;
  }
}

function snowballDispatchPrompt(url: string, templateName: string): string {
  return [
    `Start Network Snowball (${templateName}) for this seed URL.`,
    `Use workflowRunConfig.seedValue exactly — do not use the calendar title as the URL.`,
    `seedValue: ${url}`,
  ].join(" ");
}

export async function enqueueSnowballCalendarSeeds(
  seeds: EnqueueSnowballSeedInput[],
  scoutConfig: SnowballSeedScoutConfig,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EnqueueSnowballSeedsResult> {
  const apiBase = resolveRtxApiBase(env);
  if (!apiBase) {
    return { success: false, error: "RealTimeX API base URL is not configured" };
  }

  const queued: Array<{
    url: string;
    calendarEventUuid: string | null;
    scheduledAt: string;
  }> = [];
  const skipped: string[] = [];
  const deduped: string[] = [];
  const failed: Array<{ url: string; reason: string }> = [];
  const deferred: string[] = [];
  const batchDeadline = Date.now() + ENQUEUE_BATCH_BUDGET_MS;
  let workspaceSlug = env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals";
  try {
    workspaceSlug = await resolveSignalsRtxWorkspaceSlug(env, fetchImpl);
  } catch {
    // Fall back to configured slug when RTX CLI resolution is unavailable.
  }

  // Resolve the handoff target before any seed is claimed. A thread we cannot
  // resolve must abort the batch: queueing against a known-bad thread would claim
  // and confirm the seeds, deduping them permanently against a dispatch that can
  // never succeed. Failing here leaves every seed retryable on the next tick.
  let dispatchThreadSlug: string;
  try {
    dispatchThreadSlug = await resolveNetworkSnowballDispatchThread(
      workspaceSlug,
      env,
      fetchImpl,
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not resolve the Network Snowball dispatch thread",
    };
  }

  // Rows past the dedupe window can never match again; dropping them here keeps
  // the ledger bounded without needing a separate sweeper.
  pruneSnowballSeedLedger();

  const processSeed = async (seed: EnqueueSnowballSeedInput): Promise<void> => {
    const url = String(seed.url || "").trim();
    if (!url) {
      skipped.push(url);
      return;
    }

    const remainingBudget = batchDeadline - Date.now();
    if (remainingBudget < MIN_POST_BUDGET_MS) {
      // Stop cleanly rather than overrunning the caller's deadline. Nothing has
      // been claimed for this seed yet, so the next tick picks it up untouched.
      deferred.push(url);
      return;
    }

    // Signals owns "which seeds exist", so a post already queued must not be sent
    // again: the scout has no memory across ticks and the calendar ingest path we
    // use does not enforce queueMeta.dedupeKey. Claim before the POST so two
    // overlapping runs cannot both queue the same URL.
    const dedupeKey = hashUrl(url);
    const reservation = claimSeedWithSchedule(
      {
        urlHash: dedupeKey,
        url,
        platform: seed.platform ?? null,
        producerRunId: seed.producerRunId ?? null,
      },
      {
        saltMinMinutes: scoutConfig.saltMinMinutes,
        saltMaxMinutes: scoutConfig.saltMaxMinutes,
        explicitScheduledAtIso: seed.scheduledAt,
      },
    );
    if (!reservation) {
      deduped.push(url);
      return;
    }

    const { claimToken, scheduledAtIso: scheduledAt } = reservation;
    const title = formatSnowballCalendarTitle(url);
    const templateName =
      scoutConfig.networkSnowballTemplateName || NETWORK_SNOWBALL_TEMPLATE_NAME;

    const body = {
      title,
      description: `Queued by Snowball Seed Scout for ${templateName}.\nSeed URL: ${url}`,
      startDate: scheduledAt,
      allDay: false,
      color: "#22c55e",
      metadata: {
        source: "signals",
        sourceApp: "com.realtimex.signals",
        dispatchKind: "workflow.run",
        triggerMode: "scheduled",
        dispatchStatus: "scheduled",
        workflowTemplate: templateName,
        workflowRunConfig: {
          seedType: "event_url",
          seedValue: url,
          focus: scoutConfig.snowballFocus,
        },
        agentHandlers: [
          {
            agent: "cursor",
            agentName: "cursor",
            workspace: workspaceSlug,
            thread: dispatchThreadSlug,
            prompt: snowballDispatchPrompt(url, templateName),
          },
        ],
        queueMeta: {
          producerRunId: seed.producerRunId ?? null,
          platform: seed.platform ?? null,
          dedupeKey,
        },
      },
    };

    try {
      const response = await fetchImpl(`${apiBase}/api/calendar-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // Bound the request well inside the claim TTL: a POST that outlived its
        // own claim could be taken over mid-flight and queue the URL twice.
        signal: AbortSignal.timeout(
          Math.min(CALENDAR_POST_TIMEOUT_MS, remainingBudget),
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        event?: { uuid?: string };
        error?: string;
      };

      if (!response.ok) {
        // Release so the seed stays retryable rather than blocked by our own claim.
        releaseSeedClaim(dedupeKey, claimToken);
        failed.push({
          url,
          reason: payload.error || `calendar API responded ${response.status}`,
        });
        return;
      }

      const calendarEventUuid = payload.event?.uuid ?? null;
      confirmSeed(dedupeKey, claimToken, calendarEventUuid, scheduledAt);
      queued.push({ url, calendarEventUuid, scheduledAt });
    } catch (error) {
      // Every thrown request error is ambiguous. A timeout, a connection reset,
      // and a bare `fetch failed` can all occur after the server committed but
      // before the response arrived, so none of them prove the event was not
      // created. Only a non-OK HTTP response does, and that path is handled
      // above. Keep the claim and let it lapse with the claim TTL rather than
      // retrying straight into a duplicate.
      const detail = error instanceof Error ? error.message : "request failed";
      failed.push({
        url,
        reason: `calendar request failed before a response (${detail}); outcome unknown, retry deferred to ${Math.round(
          SNOWBALL_SEED_CLAIM_TTL_MS / 60_000,
        )}m claim expiry`,
      });
    }
  };

  // Drain a shared queue from a fixed number of workers. Recursive rather than a
  // `while` loop so each worker awaits one request at a time without serializing
  // the whole batch behind a single chain.
  const pending = [...seeds];
  const drain = async (): Promise<void> => {
    const seed = pending.shift();
    if (!seed) return;
    await processSeed(seed);
    return drain();
  };

  await Promise.all(
    Array.from({ length: Math.min(CALENDAR_POST_CONCURRENCY, pending.length) }, () =>
      drain(),
    ),
  );

  return { success: true, queued, skipped, deduped, failed, deferred };
}
