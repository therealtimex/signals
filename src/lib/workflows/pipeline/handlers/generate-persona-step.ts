import { getActivePersona } from "@/lib/db/queries/personas";
import {
  PersonaEvidenceError,
  PersonaGenerationUnavailableError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { refreshPersonaIfStale } from "@/lib/workflows/refresh-persona-if-stale";
import type {
  PipelineContactOutcome,
  PipelineStepContext,
  PipelineStepReport,
} from "@/lib/workflows/pipeline/types";

function personaTriggerFromPipeline(
  trigger: PipelineStepContext["trigger"],
): "user" | "scheduled" {
  return trigger === "scheduled" ? "scheduled" : "user";
}

export async function generatePersonaStepHandler(
  contactIds: string[],
  ctx: PipelineStepContext,
): Promise<PipelineStepReport> {
  const outcomes: PipelineContactOutcome[] = [];
  const personaTrigger = personaTriggerFromPipeline(ctx.trigger);
  const effectiveForcePersona =
    ctx.forcePersona && ctx.trigger !== "scheduled";

  for (const contactId of contactIds) {
    const startedAtMs = Date.now();
    try {
      const outcome = await runPersonaForContact(contactId, ctx, {
        personaTrigger,
        effectiveForcePersona,
      });
      outcomes.push(outcome);
      ctx.recordContactOutcome?.(outcome, {
        durationMs: Date.now() - startedAtMs,
      });
    } catch (error) {
      if (error instanceof PersonaGenerationUnavailableError) {
        const failedOutcome: PipelineContactOutcome = {
          contactId,
          status: "failed",
          reason: error.message,
        };
        outcomes.push(failedOutcome);
        ctx.recordContactOutcome?.(failedOutcome, {
          durationMs: Date.now() - startedAtMs,
        });
        return {
          stepId: ctx.stepId,
          outcomes,
          aborted: true,
          abortReason: error.message,
        };
      }
      throw error;
    }
  }

  return {
    stepId: ctx.stepId,
    outcomes,
    aborted: false,
  };
}

async function runPersonaForContact(
  contactId: string,
  ctx: PipelineStepContext,
  opts: { personaTrigger: "user" | "scheduled"; effectiveForcePersona: boolean },
): Promise<PipelineContactOutcome> {
  const parentWorkflowId = ctx.workflowRunId;
  const sharedOpts = {
    trigger: opts.personaTrigger,
    parentWorkflowId,
    fetchImpl: ctx.fetchImpl,
    env: ctx.env,
  };

  try {
    if (opts.effectiveForcePersona) {
      const result = await generatePersona(contactId, {
        ...sharedOpts,
        force: true,
      });
      return mapGenerateResult(contactId, result);
    }

    const activePersona = getActivePersona(contactId, { includeLocalOnly: true });
    if (!activePersona) {
      const result = await generatePersona(contactId, {
        ...sharedOpts,
        force: false,
      });
      return mapGenerateResult(contactId, result);
    }

    if (activePersona.scope === "local_only") {
      return { contactId, status: "skipped", reason: "local_only" };
    }

    if (ctx.personaStale) {
      const refresh = await refreshPersonaIfStale(contactId, sharedOpts);
      return mapRefreshResult(contactId, refresh);
    }

    return { contactId, status: "skipped", reason: "not_eligible" };
  } catch (error) {
    if (error instanceof PersonaEvidenceError) {
      return { contactId, status: "skipped", reason: "insufficient_evidence" };
    }
    if (error instanceof PersonaScopeError) {
      return { contactId, status: "skipped", reason: "local_only" };
    }
    if (error instanceof PersonaSynthesisError) {
      return { contactId, status: "failed", reason: error.message };
    }
    if (error instanceof PersonaGenerationUnavailableError) {
      throw error;
    }
    throw error;
  }
}

function mapGenerateResult(
  contactId: string,
  result: Awaited<ReturnType<typeof generatePersona>>,
): PipelineContactOutcome {
  if (result.generated) {
    return {
      contactId,
      status: "generated",
      detail: { personaWorkflowRunId: result.workflowRunId },
    };
  }
  return {
    contactId,
    status: "skipped",
    reason: result.reason,
  };
}

function mapRefreshResult(
  contactId: string,
  result: Awaited<ReturnType<typeof refreshPersonaIfStale>>,
): PipelineContactOutcome {
  if (result.refreshed) {
    return {
      contactId,
      status: "generated",
      detail: { personaWorkflowRunId: result.workflowRunId },
    };
  }

  if (result.skipped && result.reason === "fresh") {
    return { contactId, status: "skipped", reason: "fresh" };
  }

  if (result.skipped && result.reason === "evidence_unchanged") {
    return { contactId, status: "skipped", reason: "evidence_unchanged" };
  }

  if (result.skipped && result.reason === "local_only") {
    return { contactId, status: "skipped", reason: "local_only" };
  }

  if (result.skipped && result.reason === "no_persona") {
    return { contactId, status: "skipped", reason: "not_eligible" };
  }

  return { contactId, status: "skipped", reason: "not_eligible" };
}
