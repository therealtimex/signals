import type { z } from "zod";
import {
  completePersonaJobSchema,
  getPersonaJobSchema,
} from "@/lib/agent-tools/schemas";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import {
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
} from "@/lib/persona/agent-job/service";
import { persistPersonaSynthesis } from "@/lib/persona/generation/persist";
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

export async function handleGetPersonaJob(input: z.infer<typeof getPersonaJobSchema>) {
  const job = getPersonaJobById(input.jobId);
  if (!job) {
    return {
      success: false,
      code: "PERSONA_JOB_NOT_FOUND",
      error: `Persona job not found: ${input.jobId}`,
    };
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
    return {
      accepted: true,
      idempotent: true,
      personaId: job.resultPersonaId,
      supersededPersonaId: job.supersededPersonaId,
      status: "completed",
    };
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

  const activePersona = getActivePersona(job.contactId, { includeLocalOnly: true }) ?? null;
  if (activePersona?.scope === "local_only") {
    const error =
      "Cannot complete a shared persona job while an active local_only persona exists — re-scope it first.";
    const failed = markPersonaJobFailed(job.id, {
      error,
      errorCode: "scope_conflict",
      allowedStatuses: ["running", "timeout"],
    });
    if (failed?.status === "failed") {
      failWorkflowRun(failed.workflowRunId, error);
      scheduleTerminalSessionRelease(failed.rtxRuntimeSessionId);
    }
    return { success: false, code: "PERSONA_SCOPE_ERROR", error, status: "failed" };
  }

  const qualifiedModel = input.model?.trim() || job.agentModel || "terminal-agent:unknown";
  let persisted: Awaited<ReturnType<typeof persistPersonaSynthesis>>;
  try {
    persisted = await persistPersonaSynthesis({
      contactId: job.contactId,
      synthesis: parsed.data as PersonaSynthesisOutput,
      bundle: { provenance: job.provenanceParsed },
      activePersona,
      qualifiedModel,
      workflowRunId: job.workflowRunId,
      sourceWindowExtras: {
        generator: "terminal_agent",
        jobId: job.id,
        agentPromptVersion: job.agentPromptVersion,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist persona synthesis";
    const failed = markPersonaJobFailed(job.id, {
      error: message,
      errorCode: "agent_failed",
      allowedStatuses: ["running", "timeout"],
    });
    if (failed?.status === "failed") {
      failWorkflowRun(failed.workflowRunId, message);
      scheduleTerminalSessionRelease(failed.rtxRuntimeSessionId);
    }
    return { success: false, code: "PERSISTENCE_ERROR", error: message, status: "failed" };
  }

  const completed = markPersonaJobCompleted(job.id, {
    resultPersonaId: persisted.persona.id,
    agentModel: qualifiedModel,
  });
  if (!completed || completed.status !== "completed") {
    return inactiveJobResponse(job.id, completed?.status ?? job.status);
  }

  updateWorkflowRun(completed.workflowRunId, {
    status: "completed",
    model: qualifiedModel,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    result: JSON.stringify({
      personaId: persisted.persona.id,
      evidenceHash: completed.evidenceHash,
      supersededPersonaId: completed.supersededPersonaId,
      nicheEdgesUpserted: persisted.nicheEdgesUpserted,
      embedded: persisted.embedded,
    }),
    errors: JSON.stringify(persisted.embedErrors),
    completedAt: nowSec(),
  });
  scheduleTerminalSessionRelease(completed.rtxRuntimeSessionId);

  return {
    accepted: true,
    personaId: persisted.persona.id,
    supersededPersonaId: completed.supersededPersonaId,
    status: "completed",
  };
}
