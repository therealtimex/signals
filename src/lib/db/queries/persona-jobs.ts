import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbRunner } from "@/lib/db/client";
import { personaJobs } from "@/lib/db/schema";
import type { PersonaJob } from "@/lib/db/types";
import type { PersonaEvidenceProvenance } from "@/lib/db/queries/persona-evidence";

export type PersonaJobStatus = PersonaJob["status"];
export type PersonaJobTrigger = PersonaJob["trigger"];

export const PERSONA_JOB_ACTIVE_STATUSES = ["queued", "running", "completing"] as const;
const PERSONA_JOB_ABANDONABLE_STATUSES = ["queued", "running"] as const;
export const PERSONA_JOB_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "timeout",
  "superseded",
] as const;
export const PERSONA_JOB_STALE_MS = 30 * 60 * 1000;
export const PERSONA_JOB_COMPLETION_LEASE_MS = 60 * 1000;

export type PersonaJobView = PersonaJob & {
  provenanceParsed: PersonaEvidenceProvenance;
  stale: boolean;
  threadPath: string | null;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseProvenance(raw: string): PersonaEvidenceProvenance {
  return JSON.parse(raw) as PersonaEvidenceProvenance;
}

export function isPersonaJobActive(status: PersonaJobStatus): boolean {
  return (PERSONA_JOB_ACTIVE_STATUSES as readonly PersonaJobStatus[]).includes(status);
}

export function isPersonaJobTerminal(status: PersonaJobStatus): boolean {
  return (PERSONA_JOB_TERMINAL_STATUSES as readonly PersonaJobStatus[]).includes(status);
}

export function isPersonaJobStale(
  job: Pick<PersonaJob, "status" | "updatedAt">,
  nowMs = Date.now(),
): boolean {
  if (job.status === "completing") {
    return job.updatedAt * 1000 < nowMs - PERSONA_JOB_COMPLETION_LEASE_MS;
  }
  return (
    (PERSONA_JOB_ABANDONABLE_STATUSES as readonly PersonaJobStatus[]).includes(job.status) &&
    job.updatedAt * 1000 < nowMs - PERSONA_JOB_STALE_MS
  );
}

function threadPathForJob(job: PersonaJob): string | null {
  if (!job.rtxWorkspaceSlug || !job.rtxThreadSlug) return null;
  return `/workspace/${job.rtxWorkspaceSlug}/t/${job.rtxThreadSlug}`;
}

export function serializePersonaJob(job: PersonaJob, nowMs = Date.now()): PersonaJobView {
  return {
    ...job,
    provenanceParsed: parseProvenance(job.provenance),
    stale: isPersonaJobStale(job, nowMs),
    threadPath: threadPathForJob(job),
  };
}

export function createPersonaJob(input: {
  id: string;
  contactId: string;
  trigger: PersonaJobTrigger;
  force: boolean;
  promptVersion: number;
  agentPromptVersion: number;
  evidenceHash: string;
  provenance: PersonaEvidenceProvenance;
  supersededPersonaId: string | null;
  workflowRunId: string;
}): PersonaJobView {
  const ts = nowSec();
  db.insert(personaJobs)
    .values({
      id: input.id,
      contactId: input.contactId,
      status: "queued",
      trigger: input.trigger,
      force: input.force ? 1 : 0,
      promptVersion: input.promptVersion,
      agentPromptVersion: input.agentPromptVersion,
      evidenceHash: input.evidenceHash,
      provenance: JSON.stringify(input.provenance),
      supersededPersonaId: input.supersededPersonaId,
      workflowRunId: input.workflowRunId,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return getPersonaJobById(input.id)!;
}

export function getPersonaJobById(id: string): PersonaJobView | null {
  const row = db.select().from(personaJobs).where(eq(personaJobs.id, id)).get();
  return row ? serializePersonaJob(row) : null;
}

export function getLatestPersonaJobForContact(contactId: string): PersonaJobView | null {
  const row = db
    .select()
    .from(personaJobs)
    .where(eq(personaJobs.contactId, contactId))
    .orderBy(desc(personaJobs.createdAt), desc(sql`rowid`))
    .get();
  return row ? serializePersonaJob(row) : null;
}

export function getActivePersonaJobForContact(contactId: string): PersonaJobView | null {
  const row = db
    .select()
    .from(personaJobs)
    .where(
      and(
        eq(personaJobs.contactId, contactId),
        inArray(personaJobs.status, [...PERSONA_JOB_ACTIVE_STATUSES]),
      ),
    )
    .orderBy(desc(personaJobs.createdAt), desc(sql`rowid`))
    .get();
  return row ? serializePersonaJob(row) : null;
}

export function markPersonaJobSuperseded(jobId: string): PersonaJobView | null {
  const ts = nowSec();
  db.update(personaJobs)
    .set({
      status: "superseded",
      error: "Superseded by a newer persona job",
      errorCode: "superseded",
      updatedAt: ts,
      completedAt: ts,
    })
    .where(
      and(
        eq(personaJobs.id, jobId),
        inArray(personaJobs.status, [...PERSONA_JOB_ABANDONABLE_STATUSES]),
      ),
    )
    .run();
  return getPersonaJobById(jobId);
}

export function markPersonaJobRunning(
  jobId: string,
  refs: {
    rtxWorkspaceSlug: string;
    rtxThreadSlug: string;
    rtxRuntimeSessionId: string;
    agentModel: string | null;
  },
): PersonaJobView | null {
  const ts = nowSec();
  db.update(personaJobs)
    .set({
      status: "running",
      rtxWorkspaceSlug: refs.rtxWorkspaceSlug,
      rtxThreadSlug: refs.rtxThreadSlug,
      rtxRuntimeSessionId: refs.rtxRuntimeSessionId,
      agentModel: refs.agentModel,
      dispatchedAt: ts,
      updatedAt: ts,
    })
    .where(and(eq(personaJobs.id, jobId), eq(personaJobs.status, "queued")))
    .run();
  return getPersonaJobById(jobId);
}

export function markPersonaJobFailed(
  jobId: string,
  input: {
    error: string;
    errorCode: string;
    allowedStatuses?: readonly PersonaJobStatus[];
  },
): PersonaJobView | null {
  const ts = nowSec();
  const allowedStatuses = input.allowedStatuses ?? PERSONA_JOB_ACTIVE_STATUSES;
  db.update(personaJobs)
    .set({
      status: "failed",
      error: input.error,
      errorCode: input.errorCode,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(
      and(
        eq(personaJobs.id, jobId),
        inArray(personaJobs.status, [...allowedStatuses]),
      ),
    )
    .run();
  return getPersonaJobById(jobId);
}

export function markPersonaJobTimedOut(jobId: string, error: string): PersonaJobView | null {
  const ts = nowSec();
  db.update(personaJobs)
    .set({
      status: "timeout",
      error,
      errorCode: "agent_timeout",
      updatedAt: ts,
      completedAt: ts,
    })
    .where(
      and(
        eq(personaJobs.id, jobId),
        inArray(personaJobs.status, [...PERSONA_JOB_ABANDONABLE_STATUSES]),
      ),
    )
    .run();
  return getPersonaJobById(jobId);
}

export function supersedeTimedOutPersonaJobsForContact(contactId: string): void {
  const ts = nowSec();
  db.update(personaJobs)
    .set({
      status: "superseded",
      error: "Superseded by a newer persona job",
      errorCode: "superseded",
      updatedAt: ts,
      completedAt: ts,
    })
    .where(and(eq(personaJobs.contactId, contactId), eq(personaJobs.status, "timeout")))
    .run();
}

export function recordPersonaJobValidationFailure(
  jobId: string,
  error: string,
  maxAttempts: number,
): PersonaJobView | null {
  db.transaction((tx) => {
    const current = tx.select().from(personaJobs).where(eq(personaJobs.id, jobId)).get();
    if (!current || current.status !== "running") return;

    const ts = nowSec();
    const attempts = current.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    tx.update(personaJobs)
      .set({
        attempts,
        error,
        errorCode: "synthesis_invalid",
        updatedAt: ts,
        ...(exhausted ? { status: "failed" as const, completedAt: ts } : {}),
      })
      .where(and(eq(personaJobs.id, jobId), eq(personaJobs.status, "running")))
      .run();
  });
  return getPersonaJobById(jobId);
}

export function markPersonaJobCompleted(
  jobId: string,
  input: { resultPersonaId: string; agentModel?: string | null },
  runner: DbRunner = db,
): PersonaJobView | null {
  const ts = nowSec();
  const result = runner.update(personaJobs)
    .set({
      status: "completed",
      resultPersonaId: input.resultPersonaId,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      error: null,
      errorCode: null,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(and(eq(personaJobs.id, jobId), eq(personaJobs.status, "completing")))
    .run();
  if (result.changes !== 1) return null;
  const row = runner.select().from(personaJobs).where(eq(personaJobs.id, jobId)).get();
  return row ? serializePersonaJob(row) : null;
}

export type PersonaJobCompletionClaim = {
  claimed: boolean;
  job: PersonaJobView | null;
};

/**
 * Claims the one callback allowed to persist a persona. A newer job for the same
 * contact also revokes a late callback, even if the predecessor only timed out.
 */
export function claimPersonaJobCompletion(jobId: string): PersonaJobCompletionClaim {
  const claimed = db.transaction((tx) => {
    const current = tx
      .select({
        contactId: personaJobs.contactId,
        status: personaJobs.status,
        rowId: sql<number>`rowid`,
      })
      .from(personaJobs)
      .where(eq(personaJobs.id, jobId))
      .get();
    if (!current || (current.status !== "running" && current.status !== "timeout")) {
      return false;
    }

    const newer = tx
      .select({ id: personaJobs.id })
      .from(personaJobs)
      .where(
        and(
          eq(personaJobs.contactId, current.contactId),
          sql`rowid > ${current.rowId}`,
        ),
      )
      .get();
    const ts = nowSec();
    if (newer) {
      tx.update(personaJobs)
        .set({
          status: "superseded",
          error: "Superseded by a newer persona job",
          errorCode: "superseded",
          updatedAt: ts,
          completedAt: ts,
        })
        .where(and(eq(personaJobs.id, jobId), eq(personaJobs.status, current.status)))
        .run();
      return false;
    }

    const result = tx
      .update(personaJobs)
      .set({
        status: "completing",
        error: null,
        errorCode: null,
        completedAt: null,
        updatedAt: ts,
      })
      .where(and(eq(personaJobs.id, jobId), eq(personaJobs.status, current.status)))
      .run();
    return result.changes === 1;
  });

  return { claimed, job: getPersonaJobById(jobId) };
}
