import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contactPersonas } from "@/lib/db/schema";
import {
  createWorkflowRun,
  createWorkflowStep,
  nextStepIndex,
  updateWorkflowRun,
} from "@/lib/db/queries/workflows";
import { refreshPersonaIfStale } from "@/lib/workflows/refresh-persona-if-stale";
import type { EnvLike } from "@/lib/rtx/env";

export const PERSONA_REFRESH_JOB_TYPE = "maintenance:persona-refresh";
export const PERSONA_REFRESH_BATCH = 10;

/** Hard per-sweep cap — payload/caller cannot exceed PERSONA_REFRESH_BATCH (§8.2). */
export function resolvePersonaRefreshBatchSize(batchSize?: number): number {
  if (batchSize == null || !Number.isFinite(batchSize) || batchSize <= 0) {
    return PERSONA_REFRESH_BATCH;
  }
  return Math.min(Math.max(1, Math.floor(batchSize)), PERSONA_REFRESH_BATCH);
}

export type PersonaRefreshSweepReport = {
  workflowRunId: string;
  contactsConsidered: number;
  contactsRefreshed: number;
  contactsSkipped: number;
  errors: { contactId: string; message: string }[];
};

function listSharedActivePersonasForRefresh(limit: number) {
  return db
    .select({
      contactId: contactPersonas.contactId,
      personaId: contactPersonas.id,
      generatedAt: contactPersonas.generatedAt,
    })
    .from(contactPersonas)
    .where(and(eq(contactPersonas.status, "active"), eq(contactPersonas.scope, "shared")))
    .orderBy(asc(contactPersonas.generatedAt), asc(contactPersonas.id))
    .limit(limit)
    .all();
}

/** Scheduled maintenance sweep — batch-capped, oldest shared personas first (§8.2). */
export async function runPersonaRefreshSweep(opts?: {
  batchSize?: number;
  now?: number;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
}): Promise<PersonaRefreshSweepReport> {
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const batchSize = resolvePersonaRefreshBatchSize(opts?.batchSize);

  const workflowRun = createWorkflowRun({
    workflowType: "persona",
    status: "running",
    trigger: "scheduled",
    config: JSON.stringify({ mode: "refresh_sweep", batchSize }),
    startedAt: now,
  });

  const report: PersonaRefreshSweepReport = {
    workflowRunId: workflowRun.id,
    contactsConsidered: 0,
    contactsRefreshed: 0,
    contactsSkipped: 0,
    errors: [],
  };

  try {
    const candidates = listSharedActivePersonasForRefresh(batchSize);
    report.contactsConsidered = candidates.length;

    for (const candidate of candidates) {
      try {
        const result = await refreshPersonaIfStale(candidate.contactId, {
          trigger: "scheduled",
          parentWorkflowId: workflowRun.id,
          fetchImpl: opts?.fetchImpl,
          env: opts?.env,
          now,
        });

        if (result.refreshed) {
          report.contactsRefreshed += 1;
        } else {
          report.contactsSkipped += 1;
        }
      } catch (err) {
        report.errors.push({
          contactId: candidate.contactId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    updateWorkflowRun(workflowRun.id, {
      status: report.errors.length > 0 && report.contactsRefreshed === 0 ? "failed" : "completed",
      totalItems: report.contactsConsidered,
      processedItems: report.contactsConsidered,
      successItems: report.contactsRefreshed,
      skippedItems: report.contactsSkipped,
      errorItems: report.errors.length,
      result: JSON.stringify(report),
      errors: JSON.stringify(report.errors.map((entry) => entry.message)),
      completedAt: Math.floor(Date.now() / 1000),
    });

    createWorkflowStep({
      workflowRunId: workflowRun.id,
      stepIndex: nextStepIndex(workflowRun.id),
      stepType: "decision",
      status: "completed",
      output: JSON.stringify({
        contactsRefreshed: report.contactsRefreshed,
        contactsSkipped: report.contactsSkipped,
        errorCount: report.errors.length,
      }),
      tool: "persona_refresh_sweep",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateWorkflowRun(workflowRun.id, {
      status: "failed",
      errorItems: 1,
      errors: JSON.stringify([message]),
      completedAt: Math.floor(Date.now() / 1000),
    });
    throw err;
  }

  return report;
}
