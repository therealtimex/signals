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
  completePersonaJobWorkflow,
  PERSONA_AGENT_JOB_MAX_ATTEMPTS,
  reconcilePersonaJobCompletionEffects,
  reconcileStalePersonaJobCompletion,
} from "@/lib/persona/agent-job/service";
import { releasePersonaJobTerminalSession } from "@/lib/rtx/persona-terminal-teardown";
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
  if (job.status === "completed") {
    job = reconcilePersonaJobCompletionEffects(job.id) ?? job;
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

async function attachPersonaJobTerminalTeardown(
  jobId: string,
  input: { status: string; summary?: string; error?: string },
  response: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const job = getPersonaJobById(jobId);
  if (!job) return response;

  const teardown = await releasePersonaJobTerminalSession(job, input);
  return {
    ...response,
    ...(teardown.terminalSessionTeardown
      ? { terminalSessionTeardown: teardown.terminalSessionTeardown }
      : {}),
    ...(teardown.browserSessionTeardown.stopped.length > 0 ||
    teardown.browserSessionTeardown.failed.length > 0
      ? { browserSessionTeardown: teardown.browserSessionTeardown }
      : {}),
    ...(teardown.completionThreadMessage.posted
      ? { completionThreadMessage: teardown.completionThreadMessage }
      : {}),
    ...(teardown.skippedSharedSession ? { terminalSessionTeardownSkipped: "shared_session_busy" } : {}),
    ...(teardown.message ? { message: teardown.message } : {}),
  };
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
    return idempotentJobResponse(reconcilePersonaJobCompletionEffects(job.id) ?? job);
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
    }
    return attachPersonaJobTerminalTeardown(
      job.id,
      { status: failed?.status ?? "failed", error },
      { accepted: true, status: failed?.status ?? job.status, error },
    );
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
      return attachPersonaJobTerminalTeardown(
        job.id,
        { status: "failed", error: updated.error ?? synthesisErrors },
        {
          success: false,
          code: "VALIDATION_ERROR",
          error: "Persona synthesis output failed validation",
          details: { synthesisErrors, attemptsRemaining },
          status: updated.status,
        },
      );
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
    if (claim.job?.status === "completed") {
      return idempotentJobResponse(
        reconcilePersonaJobCompletionEffects(claim.job.id) ?? claim.job,
      );
    }
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
    }
    return attachPersonaJobTerminalTeardown(
      claimedJob.id,
      { status: "failed", error },
      { success: false, code: "PERSONA_SCOPE_ERROR", error, status: "failed" },
    );
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
      if (!completePersonaJobWorkflow(finished, { model: qualifiedModel }, tx)) {
        throw new Error(`Workflow run not found for persona job: ${finished.id}`);
      }
      return { persona, completed: finished };
    });
    persisted = saved.persona;
    completed = saved.completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist persona synthesis";
    const current = getPersonaJobById(claimedJob.id);
    if (current?.status === "completed") {
      return idempotentJobResponse(
        reconcilePersonaJobCompletionEffects(current.id) ?? current,
      );
    }
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
    }
    return attachPersonaJobTerminalTeardown(
      claimedJob.id,
      { status: "failed", error: message },
      { success: false, code: "PERSISTENCE_ERROR", error: message, status: "failed" },
    );
  }

  reconcilePersonaJobCompletionEffects(completed.id);

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

  completePersonaJobWorkflow(completed, {
    model: qualifiedModel,
    nicheEdgesUpserted: derivatives.nicheEdgesUpserted,
    embedded: derivatives.embedded,
    embedErrors: derivatives.embedErrors,
  });

  const summaryParts = [`Archetype: ${persisted.archetype}`];
  if (derivatives.embedded) summaryParts.push("Indexed for search.");
  if (derivatives.embedErrors.length > 0) {
    summaryParts.push(`Indexing warnings: ${derivatives.embedErrors.join("; ")}`);
  }

  return attachPersonaJobTerminalTeardown(
    completed.id,
    { status: "completed", summary: summaryParts.join(" ") },
    {
      accepted: true,
      personaId: persisted.id,
      supersededPersonaId: completed.supersededPersonaId,
      status: "completed",
    },
  );
}
