import type { z } from "zod";
import {
  completePersonaJobSchema,
  getPersonaJobSchema,
} from "@/lib/agent-tools/schemas";
import { db } from "@/lib/db/client";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import {
  claimPersonaJobCompletion,
  getPersonaJobById,
  isPersonaJobActive,
  markPersonaJobCompleted,
  markPersonaJobFailed,
  recordPersonaJobValidationFailure,
} from "@/lib/db/queries/persona-jobs";
import { getActivePersona } from "@/lib/db/queries/personas";
import { updateWorkflowRun } from "@/lib/db/queries/workflows";
import {
  PERSONA_AGENT_JOB_MAX_ATTEMPTS,
  reconcileStalePersonaJobCompletion,
} from "@/lib/persona/agent-job/service";
import {
  finishPersonaSynthesisPersistence,
  persistPersonaSynthesisRecord,
} from "@/lib/persona/generation/persist";
import {
  formatSynthesisValidationErrors,
  parsePersonaSynthesisJson,
  personaSynthesisSchema,
  type PersonaSynthesisOutput,
} from "@/lib/persona/synthesis";
import { scheduleTerminalSessionRelease } from "@/lib/rtx/resource-teardown";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function failWorkflowRun(workflowRunId: string, error: string): void {
  updateWorkflowRun(workflowRunId, {
    status: "failed",
    errors: JSON.stringify([error]),
    completedAt: nowSec(),
  });
}

function inactiveJobResponse(jobId: string, status: string) {
  return {
    success: false,
    code: "PERSONA_JOB_NOT_ACTIVE",
    error: `Persona job ${jobId} is ${status}; stop processing this job.`,
    status,
  };
}

function idempotentJobResponse(job: NonNullable<ReturnType<typeof getPersonaJobById>>) {
  return {
    accepted: true,
    idempotent: true,
    personaId: job.resultPersonaId,
    supersededPersonaId: job.supersededPersonaId,
    status: job.status,
  };
}

function completionInProgressResponse(jobId: string) {
  return {
    success: false,
    code: "PERSONA_JOB_COMPLETION_IN_PROGRESS",
    error: `Persona job ${jobId} is saving its result; retry after it reaches a terminal state.`,
    retryable: true,
    status: "completing",
  };
}

export async function handleGetPersonaJob(input: z.infer<typeof getPersonaJobSchema>) {
  let job = getPersonaJobById(input.jobId);
  if (!job) {
    return {
      success: false,
      code: "PERSONA_JOB_NOT_FOUND",
      error: `Persona job not found: ${input.jobId}`,
    };
  }
  if (job.status === "completing" && job.stale) {
    job = reconcileStalePersonaJobCompletion(job.id) ?? job;
  }

  let evidence: ReturnType<typeof assemblePersonaEvidence>["evidence"] | null = null;
  let evidenceDrifted = false;
  if (isPersonaJobActive(job.status)) {
    try {
      const current = assemblePersonaEvidence(job.contactId);
      if (current.provenance.evidenceHash === job.evidenceHash) {
        evidence = current.evidence;
      } else {
        evidenceDrifted = true;
      }
    } catch {
      evidenceDrifted = true;
    }
  }

  return {
    jobId: job.id,
    contactId: job.contactId,
    status: job.status,
    promptVersion: job.promptVersion,
    agentPromptVersion: job.agentPromptVersion,
    evidenceHash: job.evidenceHash,
    stale: job.stale,
    threadPath: job.threadPath,
    ...(isPersonaJobActive(job.status) ? { evidence, evidenceDrifted } : {}),
  };
}

function parseSynthesis(
  synthesis: string | Record<string, unknown>,
): ReturnType<typeof personaSynthesisSchema.safeParse> {
  return typeof synthesis === "string"
    ? parsePersonaSynthesisJson(synthesis)
    : personaSynthesisSchema.safeParse(synthesis);
}

export async function handleCompletePersonaJob(
  input: z.infer<typeof completePersonaJobSchema>,
) {
  const job = getPersonaJobById(input.jobId);
  if (!job) {
    return {
      success: false,
      code: "PERSONA_JOB_NOT_FOUND",
      error: `Persona job not found: ${input.jobId}`,
    };
  }

  if (job.status === "completed") {
    return idempotentJobResponse(job);
  }

  if (job.status === "completing" && input.success) {
    const reconciled = reconcileStalePersonaJobCompletion(job.id);
    if (reconciled?.status === "completed") return idempotentJobResponse(reconciled);
    if (reconciled?.status !== "completing") {
      return inactiveJobResponse(job.id, reconciled?.status ?? job.status);
    }
    return completionInProgressResponse(job.id);
  }

  if (job.status !== "running" && !(job.status === "timeout" && input.success)) {
    return inactiveJobResponse(job.id, job.status);
  }

  if (!input.success) {
    const error = input.error?.trim() || "The terminal agent could not produce a persona.";
    const failed = markPersonaJobFailed(job.id, {
      error,
      errorCode: "agent_failed",
      allowedStatuses: ["running"],
    });
    if (failed?.status === "failed") {
      failWorkflowRun(failed.workflowRunId, error);
      scheduleTerminalSessionRelease(failed.rtxRuntimeSessionId);
    }
    return { accepted: true, status: failed?.status ?? job.status, error };
  }

  const parsed = parseSynthesis(input.synthesis!);
  if (!parsed.success) {
    if (job.status === "timeout") {
      return inactiveJobResponse(job.id, job.status);
    }

    const synthesisErrors = formatSynthesisValidationErrors(parsed.error);
    const updated = recordPersonaJobValidationFailure(
      job.id,
      `Persona synthesis output failed validation: ${synthesisErrors}`,
      PERSONA_AGENT_JOB_MAX_ATTEMPTS,
    );
    const attempts = updated?.attempts ?? job.attempts + 1;
    const attemptsRemaining = Math.max(0, PERSONA_AGENT_JOB_MAX_ATTEMPTS - attempts);
    if (updated?.status === "failed") {
      failWorkflowRun(updated.workflowRunId, updated.error ?? synthesisErrors);
      scheduleTerminalSessionRelease(updated.rtxRuntimeSessionId);
    }
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "Persona synthesis output failed validation",
      details: { synthesisErrors, attemptsRemaining },
      status: updated?.status ?? job.status,
    };
  }

  const claim = claimPersonaJobCompletion(job.id);
  if (!claim.claimed) {
    if (claim.job?.status === "completed") return idempotentJobResponse(claim.job);
    if (claim.job?.status === "completing") {
      const reconciled = reconcileStalePersonaJobCompletion(claim.job.id);
      if (reconciled?.status === "completed") return idempotentJobResponse(reconciled);
      if (reconciled?.status === "completing") {
        return completionInProgressResponse(claim.job.id);
      }
      return inactiveJobResponse(job.id, reconciled?.status ?? claim.job.status);
    }
    return inactiveJobResponse(job.id, claim.job?.status ?? job.status);
  }
  const claimedJob = claim.job!;

  const activePersona = getActivePersona(claimedJob.contactId, { includeLocalOnly: true }) ?? null;
  if (activePersona?.scope === "local_only") {
    const error =
      "Cannot complete a shared persona job while an active local_only persona exists — re-scope it first.";
    const failed = markPersonaJobFailed(claimedJob.id, {
      error,
      errorCode: "scope_conflict",
      allowedStatuses: ["completing"],
    });
    if (failed?.status === "failed") {
      failWorkflowRun(failed.workflowRunId, error);
      scheduleTerminalSessionRelease(failed.rtxRuntimeSessionId);
    }
    return { success: false, code: "PERSONA_SCOPE_ERROR", error, status: "failed" };
  }

  const qualifiedModel = input.model?.trim() || claimedJob.agentModel || "terminal-agent:unknown";
  let persisted: ReturnType<typeof persistPersonaSynthesisRecord>;
  let completed: NonNullable<ReturnType<typeof markPersonaJobCompleted>>;
  try {
    const saved = db.transaction((tx) => {
      const persona = persistPersonaSynthesisRecord(
        {
          contactId: claimedJob.contactId,
          synthesis: parsed.data as PersonaSynthesisOutput,
          bundle: { provenance: claimedJob.provenanceParsed },
          activePersona,
          qualifiedModel,
          workflowRunId: claimedJob.workflowRunId,
          sourceWindowExtras: {
            generator: "terminal_agent",
            jobId: claimedJob.id,
            agentPromptVersion: claimedJob.agentPromptVersion,
          },
        },
        tx,
      );
      const finished = markPersonaJobCompleted(
        claimedJob.id,
        {
          resultPersonaId: persona.id,
          agentModel: qualifiedModel,
        },
        tx,
      );
      if (!finished) {
        throw new Error("Persona completion claim was lost before persistence committed");
      }
      return { persona, completed: finished };
    });
    persisted = saved.persona;
    completed = saved.completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist persona synthesis";
    const current = getPersonaJobById(claimedJob.id);
    if (current?.status === "completed") return idempotentJobResponse(current);
    if (current?.status !== "completing") {
      return inactiveJobResponse(claimedJob.id, current?.status ?? claimedJob.status);
    }
    const failed = markPersonaJobFailed(claimedJob.id, {
      error: message,
      errorCode: "agent_failed",
      allowedStatuses: ["completing"],
    });
    if (failed?.status === "failed") {
      failWorkflowRun(failed.workflowRunId, message);
      scheduleTerminalSessionRelease(failed.rtxRuntimeSessionId);
    }
    return { success: false, code: "PERSISTENCE_ERROR", error: message, status: "failed" };
  }

  updateWorkflowRun(completed.workflowRunId, {
    status: "completed",
    model: qualifiedModel,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    result: JSON.stringify({
      personaId: persisted.id,
      evidenceHash: completed.evidenceHash,
      supersededPersonaId: completed.supersededPersonaId,
      nicheEdgesUpserted: 0,
      embedded: false,
    }),
    errors: "[]",
    completedAt: nowSec(),
  });
  scheduleTerminalSessionRelease(completed.rtxRuntimeSessionId);

  let derivatives = {
    nicheEdgesUpserted: 0,
    embedded: false,
    embedErrors: [] as string[],
  };
  try {
    derivatives = await finishPersonaSynthesisPersistence({
      persona: persisted,
      workflowRunId: completed.workflowRunId,
    });
  } catch (error) {
    derivatives.embedErrors.push(
      error instanceof Error ? error.message : "Failed to finish persona indexing",
    );
  }

  updateWorkflowRun(completed.workflowRunId, {
    result: JSON.stringify({
      personaId: persisted.id,
      evidenceHash: completed.evidenceHash,
      supersededPersonaId: completed.supersededPersonaId,
      nicheEdgesUpserted: derivatives.nicheEdgesUpserted,
      embedded: derivatives.embedded,
    }),
    errors: JSON.stringify(derivatives.embedErrors),
  });

  return {
    accepted: true,
    personaId: persisted.id,
    supersededPersonaId: completed.supersededPersonaId,
    status: "completed",
  };
}
