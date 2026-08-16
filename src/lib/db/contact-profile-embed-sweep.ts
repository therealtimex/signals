import { db, sqlite } from "@/lib/db/client";
import { assembleEmbedText, getLatestEmbedding } from "@/lib/db/queries/embeddings";
import { getScheduledJob } from "@/lib/db/queries/scheduled-jobs";
import { contacts, scheduledJobs } from "@/lib/db/schema";
import { embedNodeIfStale, EmbeddingUnavailableError } from "@/lib/embeddings/embed-node";
import { truncateEmbedText } from "@/lib/embeddings/vector-utils";
import { sha256EmbedText } from "@/lib/rtx/llm";
import type { EnvLike } from "@/lib/rtx/env";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export const CONTACT_PROFILE_EMBED_SWEEP_KEY = "contact-profile-employment-text-v1";
export const CONTACT_PROFILE_EMBED_SWEEP_JOB_TYPE = "maintenance:contact-profile-embed-sweep";
export const CONTACT_PROFILE_EMBED_SWEEP_BATCH = 25;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function ensureBackfillMarkersTable(): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _backfill_markers (key TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
}

function backfillMarkerApplied(key: string): boolean {
  ensureBackfillMarkersTable();
  return sqlite.prepare("SELECT 1 FROM _backfill_markers WHERE key = ?").get(key) !== undefined;
}

function markBackfillApplied(key: string): void {
  ensureBackfillMarkersTable();
  sqlite
    .prepare("INSERT OR IGNORE INTO _backfill_markers (key, applied_at) VALUES (?, ?)")
    .run(key, nowUnix());
}

export function isContactProfileEmbedSweepComplete(): boolean {
  return backfillMarkerApplied(CONTACT_PROFILE_EMBED_SWEEP_KEY);
}

/** Test helper — clears the one-time completion marker between isolated sweep cases. */
export function resetContactProfileEmbedSweepStateForTests(): void {
  ensureBackfillMarkersTable();
  sqlite.prepare("DELETE FROM _backfill_markers WHERE key = ?").run(CONTACT_PROFILE_EMBED_SWEEP_KEY);
}

export function contactNeedsProfileReembed(contactId: string): boolean {
  try {
    const text = truncateEmbedText(assembleEmbedText("contact", contactId, "profile"));
    const contentHash = sha256EmbedText(text);
    const latest = getLatestEmbedding("contact", contactId, "profile");
    return !latest || latest.contentHash !== contentHash;
  } catch {
    return false;
  }
}

export function listContactsNeedingProfileReembed(limit?: number): string[] {
  const ids = db.select({ id: contacts.id }).from(contacts).all().map((row) => row.id);
  const pending = ids.filter(contactNeedsProfileReembed);
  return limit == null ? pending : pending.slice(0, limit);
}

export type ContactProfileEmbedSweepReport = {
  complete: boolean;
  processed: number;
  embedded: number;
  skipped: number;
  remaining: number;
  errors: { contactId: string; message: string }[];
};

export function resolveContactProfileEmbedBatchSize(batchSize?: number): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize <= 0) {
    return CONTACT_PROFILE_EMBED_SWEEP_BATCH;
  }
  return Math.max(1, Math.floor(batchSize));
}

/** Resumable regeneration of contact profile embeddings after employment-backed text rollout. */
export async function runContactProfileEmbedSweep(opts?: {
  batchSize?: number;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
}): Promise<ContactProfileEmbedSweepReport> {
  if (isContactProfileEmbedSweepComplete()) {
    return {
      complete: true,
      processed: 0,
      embedded: 0,
      skipped: 0,
      remaining: 0,
      errors: [],
    };
  }

  const batchSize = resolveContactProfileEmbedBatchSize(opts?.batchSize);
  const pending = listContactsNeedingProfileReembed(batchSize);
  const report: ContactProfileEmbedSweepReport = {
    complete: false,
    processed: 0,
    embedded: 0,
    skipped: 0,
    remaining: 0,
    errors: [],
  };

  for (const contactId of pending) {
    report.processed++;
    try {
      const result = await embedNodeIfStale("contact", contactId, "profile", opts);
      if (result.embedded) report.embedded++;
      else report.skipped++;
    } catch (error) {
      if (error instanceof EmbeddingUnavailableError) {
        report.errors.push({ contactId, message: error.message });
        break;
      }
      report.errors.push({ contactId, message: (error as Error).message });
    }
  }

  report.remaining = listContactsNeedingProfileReembed().length;
  if (report.remaining === 0 && report.errors.length === 0) {
    markBackfillApplied(CONTACT_PROFILE_EMBED_SWEEP_KEY);
    report.complete = true;
  } else if (report.remaining > 0 && report.errors.length === 0) {
    ensureContactProfileEmbedSweepJob();
  }

  return report;
}

/** Enqueue a one-shot maintenance job when profile embeddings still need regeneration. */
export function ensureContactProfileEmbedSweepJob(now = nowUnix()): boolean {
  if (isContactProfileEmbedSweepComplete()) return false;

  const existing = db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.jobType, CONTACT_PROFILE_EMBED_SWEEP_JOB_TYPE),
        eq(scheduledJobs.status, "pending"),
        eq(scheduledJobs.enabled, 1),
      ),
    )
    .get();
  if (existing) return false;

  const id = nanoid();
  db.insert(scheduledJobs)
    .values({
      id,
      jobType: CONTACT_PROFILE_EMBED_SWEEP_JOB_TYPE,
      status: "pending",
      runAt: now,
      enabled: 1,
      payload: JSON.stringify({}),
    })
    .run();
  return true;
}

/** Process batches until caught up or the embed provider is unavailable. */
export async function runContactProfileEmbedSweepUntilCaughtUp(opts?: {
  batchSize?: number;
  maxBatches?: number;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
}): Promise<ContactProfileEmbedSweepReport> {
  const maxBatches = opts?.maxBatches ?? 100;
  let report: ContactProfileEmbedSweepReport = {
    complete: isContactProfileEmbedSweepComplete(),
    processed: 0,
    embedded: 0,
    skipped: 0,
    remaining: listContactsNeedingProfileReembed().length,
    errors: [],
  };

  if (report.complete) return report;

  for (let batch = 0; batch < maxBatches; batch++) {
    report = await runContactProfileEmbedSweep(opts);
    if (report.complete || report.errors.length > 0 || report.processed === 0) {
      return report;
    }
  }

  if (!report.complete && report.remaining > 0 && report.errors.length === 0) {
    ensureContactProfileEmbedSweepJob();
  }

  return report;
}

export function getPendingContactProfileEmbedSweepJobId(): string | null {
  const row = db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.jobType, CONTACT_PROFILE_EMBED_SWEEP_JOB_TYPE),
        eq(scheduledJobs.status, "pending"),
        eq(scheduledJobs.enabled, 1),
      ),
    )
    .get();
  return row?.id ?? null;
}

export function isContactProfileEmbedSweepJob(id: string): boolean {
  const job = getScheduledJob(id);
  return job?.jobType === CONTACT_PROFILE_EMBED_SWEEP_JOB_TYPE;
}
