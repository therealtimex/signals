import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, sqlite } from "@/lib/db/client";
import {
  AVATAR_ENRICH_RETRY_SECONDS,
  AVATAR_THROTTLE_COOLDOWN_SECONDS,
  planProfilePipelineRun,
} from "@/lib/db/queries/profile-pipeline-backlog";
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

/**
 * Contacts eligible for avatar work whose source is a platform CDN rather than the metered
 * resolver. Selecting these directly matters: the general backlog is ordered by enrichment score,
 * so a 25-contact window almost never contains one of the ~335 CDN-backed contacts scattered
 * through a ~2,900-row backlog, and the sweep trips its transient guard without ever reaching work
 * it could have done (#435).
 *
 * The eligibility guards mirror `needsAvatarPredicate`; only the source filter is extra.
 */
function listUnmeteredCandidates(limit: number, now: number): string[] {
  const retryCutoff = now - AVATAR_ENRICH_RETRY_SECONDS;
  const throttleCutoff = now - AVATAR_THROTTLE_COOLDOWN_SECONDS;

  return sqlite
    .prepare(
      `SELECT c.id AS id
         FROM contacts c
         JOIN contact_identities i ON i.contact_id = c.id AND i.is_active = 1
        WHERE json_extract(c.metadata, '$.archived') IS NOT 1
          AND c.is_self = 0
          AND json_extract(c.metadata, '$.platformActor') IS NOT 1
          AND json_extract(c.metadata, '$.avatarEnrich.gravatarVerifiedAt') IS NULL
          AND (json_extract(c.metadata, '$.avatarEnrich.exhaustedAt') IS NULL
               OR json_extract(c.metadata, '$.avatarEnrich.exhaustedAt') < ?)
          AND (json_extract(c.metadata, '$.avatarEnrich.throttledAt') IS NULL
               OR json_extract(c.metadata, '$.avatarEnrich.throttledAt') < ?)
          AND NOT EXISTS (SELECT 1 FROM media_attachments m
                           WHERE m.parent_type = 'contact' AND m.parent_id = c.id
                             AND m.role = 'avatar')
          AND (i.avatar_url LIKE '%licdn.com%'
               OR i.avatar_url LIKE '%pbs.twimg.com%'
               OR i.platform_data LIKE '%profile_image_url%'
               OR i.platform_data LIKE '%photoUrl%'
               OR i.platform_data LIKE '%"picture"%')
        GROUP BY c.id
        ORDER BY c.enrichment_score ASC, c.updated_at ASC, c.id ASC
        LIMIT ?`,
    )
    .all(retryCutoff, throttleCutoff, limit)
    .map((row) => (row as { id: string }).id);
}

/**
 * Contacts still needing a locally cached avatar. Unmetered sources are selected first and the
 * remainder topped up from the general backlog, so a refusing resolver never hides available work.
 */
export function planAvatarCacheSweep(limit = AVATAR_CACHE_SWEEP_BATCH): {
  contactIds: string[];
  backlogTotal: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const unmetered = listUnmeteredCandidates(limit, now);
  const plan = planProfilePipelineRun({
    batchSize: limit,
    filters: { needsAvatar: true, needsPersona: false, personaStale: false },
  });

  const seen = new Set(unmetered);
  const topUp = plan.selectedContactIds.filter((id) => !seen.has(id));

  return {
    contactIds: [...unmetered, ...topUp].slice(0, limit),
    backlogTotal: plan.backlogTotal,
  };
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
