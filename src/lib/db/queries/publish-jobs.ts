import { eq, desc, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { publishJobs } from "@/lib/db/schema";
import { updateContentItem } from "@/lib/db/queries/content";
import {
  deriveItemStatusFromJob,
  recomputeJobStatus,
} from "@/lib/publish/job-state";
import type {
  PublishJobPayload,
  PublishJobStatus,
  PublishJobTarget,
  PublishPlatformTarget,
} from "@/lib/publish/types";
import { PUBLISH_JOB_STALE_MS } from "@/lib/publish/types";
import type { InferSelectModel } from "drizzle-orm";

export type PublishJob = InferSelectModel<typeof publishJobs>;

export type PublishJobView = PublishJob & {
  payloadParsed: PublishJobPayload;
  targetsParsed: PublishJobTarget[];
  stale?: boolean;
};

const ACTIVE_JOB_STATUSES: PublishJobStatus[] = ["queued", "publishing"];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parsePayload(raw: string): PublishJobPayload {
  return JSON.parse(raw) as PublishJobPayload;
}

function parseTargets(raw: string): PublishJobTarget[] {
  return JSON.parse(raw) as PublishJobTarget[];
}

function serializeJob(row: PublishJob, annotateStale = true): PublishJobView {
  const payloadParsed = parsePayload(row.payload);
  const targetsParsed = parseTargets(row.targets);
  const stale =
    annotateStale &&
    ACTIVE_JOB_STATUSES.includes(row.status as PublishJobStatus) &&
    row.updatedAt * 1000 < Date.now() - PUBLISH_JOB_STALE_MS;

  return {
    ...row,
    payloadParsed,
    targetsParsed,
    ...(stale ? { stale: true } : {}),
  };
}

export function createPublishJob(input: {
  contentItemId: string;
  payload: PublishJobPayload;
  platforms: PublishPlatformTarget[];
  targets?: PublishJobTarget[];
}): PublishJobView {
  const ts = nowSec();
  const targets: PublishJobTarget[] =
    input.targets ??
    input.platforms.map((platform) => ({
      platform,
      status: "pending",
    }));

  const row: typeof publishJobs.$inferInsert = {
    id: `pj_${nanoid()}`,
    contentItemId: input.contentItemId,
    status: "queued",
    payload: JSON.stringify(input.payload),
    targets: JSON.stringify(targets),
    createdAt: ts,
    updatedAt: ts,
  };

  db.insert(publishJobs).values(row).run();
  return serializeJob(row as PublishJob, false);
}

export function getPublishJobById(id: string): PublishJobView | null {
  const row = db.select().from(publishJobs).where(eq(publishJobs.id, id)).get();
  return row ? serializeJob(row) : null;
}

export function listPublishJobsForContentItem(contentItemId: string): PublishJobView[] {
  return db
    .select()
    .from(publishJobs)
    .where(eq(publishJobs.contentItemId, contentItemId))
    .orderBy(desc(publishJobs.createdAt))
    .all()
    .map((row) => serializeJob(row));
}

export function getLatestPublishJobForContentItem(
  contentItemId: string
): PublishJobView | null {
  const rows = listPublishJobsForContentItem(contentItemId);
  return rows[0] ?? null;
}

export function getActivePublishJobForContentItem(
  contentItemId: string
): PublishJobView | null {
  const row = db
    .select()
    .from(publishJobs)
    .where(
      and(
        eq(publishJobs.contentItemId, contentItemId),
        inArray(publishJobs.status, ACTIVE_JOB_STATUSES)
      )
    )
    .orderBy(desc(publishJobs.createdAt))
    .get();
  return row ? serializeJob(row) : null;
}

export function supersedeActiveJobsForContentItem(contentItemId: string): void {
  const ts = nowSec();
  db.update(publishJobs)
    .set({ status: "superseded", updatedAt: ts })
    .where(
      and(
        eq(publishJobs.contentItemId, contentItemId),
        inArray(publishJobs.status, ACTIVE_JOB_STATUSES)
      )
    )
    .run();
}

export function updatePublishJobRtxRefs(
  jobId: string,
  refs: {
    rtxWorkspaceSlug: string;
    rtxThreadSlug: string;
    rtxRuntimeSessionId: string;
  }
): PublishJobView | null {
  const ts = nowSec();
  db.update(publishJobs)
    .set({
      rtxWorkspaceSlug: refs.rtxWorkspaceSlug,
      rtxThreadSlug: refs.rtxThreadSlug,
      rtxRuntimeSessionId: refs.rtxRuntimeSessionId,
      updatedAt: ts,
    })
    .where(eq(publishJobs.id, jobId))
    .run();
  return getPublishJobById(jobId);
}

export function markPublishJobLaunchFailed(
  jobId: string,
  error: string,
  errorCode: string
): PublishJobView | null {
  const ts = nowSec();
  db.update(publishJobs)
    .set({
      status: "failed",
      error,
      errorCode,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(eq(publishJobs.id, jobId))
    .run();
  return getPublishJobById(jobId);
}

export function applyPublishJobTargets(
  jobId: string,
  targets: PublishJobTarget[],
  options?: { driveItemStatus?: boolean }
): PublishJobView | null {
  const existing = getPublishJobById(jobId);
  if (!existing) return null;

  const jobStatus = recomputeJobStatus(targets);
  const ts = nowSec();
  const terminal = ["completed", "partial", "failed"].includes(jobStatus);

  db.update(publishJobs)
    .set({
      targets: JSON.stringify(targets),
      status: jobStatus,
      updatedAt: ts,
      ...(terminal ? { completedAt: ts } : {}),
    })
    .where(eq(publishJobs.id, jobId))
    .run();

  const updated = getPublishJobById(jobId);
  if (!updated) return null;

  if (options?.driveItemStatus !== false && existing.status !== "superseded") {
    const itemStatus = deriveItemStatusFromJob(updated.status as PublishJobStatus, targets);
    if (itemStatus) {
      updateContentItem(updated.contentItemId, { status: itemStatus });
    }
  }

  return updated;
}

/** Update targets on a superseded job without recomputing job/item status. */
export function recordPublishJobTargets(
  jobId: string,
  targets: PublishJobTarget[]
): PublishJobView | null {
  const existing = getPublishJobById(jobId);
  if (!existing) return null;

  const ts = nowSec();
  db.update(publishJobs)
    .set({
      targets: JSON.stringify(targets),
      updatedAt: ts,
    })
    .where(eq(publishJobs.id, jobId))
    .run();

  return getPublishJobById(jobId);
}

export function syncItemStatusFromJob(job: PublishJobView): void {
  if (job.status === "superseded") return;
  const itemStatus = deriveItemStatusFromJob(
    job.status as PublishJobStatus,
    job.targetsParsed
  );
  if (itemStatus) {
    updateContentItem(job.contentItemId, { status: itemStatus });
  }
}

export function markStalePublishJobFailed(jobId: string): PublishJobView | null {
  const job = getPublishJobById(jobId);
  if (!job || !job.stale) return job;
  if (!ACTIVE_JOB_STATUSES.includes(job.status as PublishJobStatus)) return job;

  const targets = job.targetsParsed.map((t) =>
    t.status === "pending" || t.status === "publishing"
      ? {
          ...t,
          status: "failed" as const,
          error: "Publish job timed out",
          errorCode: "timeout",
          completedAt: nowSec(),
        }
      : t
  );

  return applyPublishJobTargets(jobId, targets, { driveItemStatus: true });
}
