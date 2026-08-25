import { createHash } from "node:crypto";
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
      skipped: string[];
    }
  | { success: false; error: string };

function hashUrl(url: string): string {
  return createHash("sha256").update(url.trim()).digest("hex");
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

  for (const seed of seeds) {
    const url = String(seed.url || "").trim();
    if (!url) {
      skipped.push(url);
      continue;
    }

    const scheduledAt = scheduledStartIso(
      scoutConfig.saltMinMinutes,
      scoutConfig.saltMaxMinutes,
      seed.scheduledAt,
    );
    const title = `[Signals] Snowball: ${url.slice(0, 72)}`;
    const templateName =
      scoutConfig.networkSnowballTemplateName || NETWORK_SNOWBALL_TEMPLATE_NAME;

    const body = {
      title,
      description: `Queued by Snowball Seed Scout for ${templateName}`,
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
            workspace: env.SIGNALS_RTX_WORKSPACE_SLUG?.trim() || "signals",
            thread: "network-snowball",
            prompt:
              "Start Network Snowball for the queued seed URL in this calendar event metadata (workflowRunConfig.seedValue).",
          },
        ],
        queueMeta: {
          producerRunId: seed.producerRunId ?? null,
          platform: seed.platform ?? null,
          dedupeKey: hashUrl(url),
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
        skipped.push(url);
        continue;
      }

      queued.push({
        url,
        calendarEventUuid: payload.event?.uuid ?? null,
        scheduledAt,
      });
    } catch {
      skipped.push(url);
    }
  }

  return { success: true, queued, skipped };
}
