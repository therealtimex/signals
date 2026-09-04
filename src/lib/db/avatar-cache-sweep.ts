import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { planProfilePipelineRun } from "@/lib/db/queries/profile-pipeline-backlog";
import { scheduledJobs } from "@/lib/db/schema";
import { enrichContactAvatars } from "@/lib/workflows/pipeline/handlers/enrich-contact-avatars";

/**
 * Unattended avatar backfill.
 *
 * The profile pipeline already caches avatars, but it runs hydration and persona generation in the
 * same pass, and either can stall the batch — a tripped X breaker or an unconfigured LLM stops
 * avatar work that has nothing to do with either (#436, #438). This sweep does avatar work only, so
 * the backlog drains on its own regardless of what else is unavailable.
 *
 * It is deliberately slow. The resolver behind most remaining contacts allows on the order of 50
 * requests a day, so this is sized to trickle over weeks rather than to finish in one run (#435).
 */
export const AVATAR_CACHE_SWEEP_JOB_TYPE = "maintenance:avatar-cache-sweep";
export const AVATAR_CACHE_SWEEP_BATCH = 25;

/**
 * Consecutive transient failures before a sweep gives up for this run. Once the resolver starts
 * refusing, every further contact in the batch would refuse too — spending requests to learn the
 * same thing and stamping cooldowns on contacts that were never actually tried on their merits.
 */
export const AVATAR_CACHE_SWEEP_TRANSIENT_LIMIT = 3;

export type AvatarCacheSweepReport = {
  selected: number;
  cached: number;
  transient: number;
  remaining: number;
  complete: boolean;
  stoppedEarly: boolean;
};

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Contacts still needing a locally cached avatar, lowest enrichment first. */
export function planAvatarCacheSweep(limit = AVATAR_CACHE_SWEEP_BATCH): {
  contactIds: string[];
  backlogTotal: number;
} {
  const plan = planProfilePipelineRun({
    batchSize: limit,
    filters: { needsAvatar: true, needsPersona: false, personaStale: false },
  });
  return { contactIds: plan.selectedContactIds, backlogTotal: plan.backlogTotal };
}

export async function runAvatarCacheSweep(opts?: {
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<AvatarCacheSweepReport> {
  const limit = opts?.limit ?? AVATAR_CACHE_SWEEP_BATCH;
  const { contactIds, backlogTotal } = planAvatarCacheSweep(limit);

  let cached = 0;
  let transient = 0;
  let consecutiveTransient = 0;
  let stoppedEarly = false;

  for (const contactId of contactIds) {
    const report = await enrichContactAvatars([contactId], {
      workflowRunId: `avatar-cache-sweep-${contactId}`,
      stepId: "avatar",
      trigger: "scheduled",
      forcePersona: false,
      personaStale: false,
      fetchImpl: opts?.fetchImpl ?? fetch,
      env: {},
      appendThreadMessage: async () => undefined,
    });

    const outcome = report.outcomes[0];
    if (outcome?.status === "updated") {
      cached++;
      consecutiveTransient = 0;
      continue;
    }
    if (outcome?.status === "failed") {
      transient++;
      consecutiveTransient++;
      if (consecutiveTransient >= AVATAR_CACHE_SWEEP_TRANSIENT_LIMIT) {
        stoppedEarly = true;
        break;
      }
      continue;
    }
    consecutiveTransient = 0;
  }

  const { backlogTotal: remaining } = planAvatarCacheSweep(1);

  return {
    selected: contactIds.length,
    cached,
    transient,
    remaining,
    complete: remaining === 0,
    stoppedEarly,
  };
}

/** Enqueue the next sweep when work remains and one is not already pending. */
export function ensureAvatarCacheSweepJob(now = nowUnix(), runAt = now): boolean {
  const { backlogTotal } = planAvatarCacheSweep(1);
  if (backlogTotal === 0) return false;

  const existing = db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.jobType, AVATAR_CACHE_SWEEP_JOB_TYPE),
        eq(scheduledJobs.status, "pending"),
        eq(scheduledJobs.enabled, 1),
      ),
    )
    .get();
  if (existing) return false;

  db.insert(scheduledJobs)
    .values({
      id: nanoid(),
      jobType: AVATAR_CACHE_SWEEP_JOB_TYPE,
      status: "pending",
      runAt,
      enabled: 1,
      payload: JSON.stringify({}),
    })
    .run();
  return true;
}
