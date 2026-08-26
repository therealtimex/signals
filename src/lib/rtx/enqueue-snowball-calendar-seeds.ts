import { createHash } from "node:crypto";
import { resolveSignalsRtxWorkspaceSlug } from "@/lib/rtx/cli-provisioning";
import {
  claimSeed,
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
    }
  | { success: false; error: string };

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

function randomSaltMinutes(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function scheduledStartIso(
  saltMinMinutes: number,
  saltMaxMinutes: number,
  explicit?: string | null,
): string {
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const delayMinutes = randomSaltMinutes(saltMinMinutes, saltMaxMinutes);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
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
  let workspaceSlug = env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals";
  try {
    workspaceSlug = await resolveSignalsRtxWorkspaceSlug(env, fetchImpl);
  } catch {
    // Fall back to configured slug when RTX CLI resolution is unavailable.
  }

  // Rows past the dedupe window can never match again; dropping them here keeps
  // the ledger bounded without needing a separate sweeper.
  pruneSnowballSeedLedger();

  for (const seed of seeds) {
    const url = String(seed.url || "").trim();
    if (!url) {
      skipped.push(url);
      continue;
    }

    // Signals owns "which seeds exist", so a post already queued must not be sent
    // again: the scout has no memory across ticks and the calendar ingest path we
    // use does not enforce queueMeta.dedupeKey. Claim before the POST so two
    // overlapping runs cannot both queue the same URL.
    const dedupeKey = hashUrl(url);
    if (
      !claimSeed({
        urlHash: dedupeKey,
        url,
        platform: seed.platform ?? null,
        producerRunId: seed.producerRunId ?? null,
      })
    ) {
      deduped.push(url);
      continue;
    }

    const scheduledAt = scheduledStartIso(
      scoutConfig.saltMinMinutes,
      scoutConfig.saltMaxMinutes,
      seed.scheduledAt,
    );
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
            thread: "network-snowball",
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
      });
      const payload = (await response.json().catch(() => ({}))) as {
        event?: { uuid?: string };
        error?: string;
      };

      if (!response.ok) {
        // Release so the seed stays retryable rather than blocked by our own claim.
        releaseSeedClaim(dedupeKey);
        failed.push({
          url,
          reason: payload.error || `calendar API responded ${response.status}`,
        });
        continue;
      }

      const calendarEventUuid = payload.event?.uuid ?? null;
      confirmSeed(dedupeKey, calendarEventUuid);
      queued.push({ url, calendarEventUuid, scheduledAt });
    } catch (error) {
      releaseSeedClaim(dedupeKey);
      failed.push({
        url,
        reason: error instanceof Error ? error.message : "calendar request failed",
      });
    }
  }

  return { success: true, queued, skipped, deduped, failed };
}
