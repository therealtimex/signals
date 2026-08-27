import { renderPersonaEvidencePrompt } from "@/lib/db/queries/persona-evidence";
import {
  PersonaGenerationUnavailableError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import type { SerializedContactPersona } from "@/lib/db/queries/personas";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { persistPersonaSynthesis } from "@/lib/persona/generation/persist";
import {
  preparePersonaGeneration,
  type PreparedPersonaGeneration,
} from "@/lib/persona/generation/prepare";
import {
  formatSynthesisValidationErrors,
  parsePersonaSynthesisJson,
  PERSONA_PROMPT_VERSION,
  PERSONA_SYSTEM_PROMPT,
  type PersonaSynthesisOutput,
} from "@/lib/persona/synthesis";
import { rtxChat } from "@/lib/rtx/llm";
import type { EnvLike } from "@/lib/rtx/env";

export type GeneratePersonaResult =
  | {
      generated: true;
      persona: SerializedContactPersona;
      workflowRunId: string;
      supersededPersonaId: string | null;
      nicheEdgesUpserted: number;
      embedded: boolean;
    }
  | { generated: false; skipped: true; reason: "evidence_unchanged"; personaId: string };

export type GeneratePersonaOptions = {
  force?: boolean;
  trigger?: "user" | "scheduled";
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  parentWorkflowId?: string | null;
};

function accumulateChatUsage(
  totals: { inputTokens: number; outputTokens: number },
  chatResult: { inputTokens: number | null; outputTokens: number | null },
): void {
  totals.inputTokens += chatResult.inputTokens ?? 0;
  totals.outputTokens += chatResult.outputTokens ?? 0;
}

async function synthesizePersonaOutput(
  evidencePrompt: string,
  fetchImpl: typeof fetch,
  env: EnvLike,
  usage: { inputTokens: number; outputTokens: number },
): Promise<{
  synthesis: PersonaSynthesisOutput;
  qualifiedModel: string;
}> {
  const messages = [
    { role: "system" as const, content: PERSONA_SYSTEM_PROMPT },
    { role: "user" as const, content: evidencePrompt },
  ];

  let chatResult = await rtxChat(messages, fetchImpl, env);
  if (!chatResult.success) {
    throw new PersonaGenerationUnavailableError(chatResult.code, chatResult.error);
  }
  accumulateChatUsage(usage, chatResult);

  let parsed = parsePersonaSynthesisJson(chatResult.text);
  if (parsed.success) {
    return {
      synthesis: parsed.data,
      qualifiedModel: chatResult.qualifiedModel,
    };
  }

  const repairMessages = [
    ...messages,
    { role: "assistant" as const, content: chatResult.text },
    {
      role: "user" as const,
      content: `Your previous output failed validation: ${formatSynthesisValidationErrors(parsed.error)}. Return only corrected JSON.`,
    },
  ];

  chatResult = await rtxChat(repairMessages, fetchImpl, env);
  if (!chatResult.success) {
    throw new PersonaGenerationUnavailableError(chatResult.code, chatResult.error);
  }
  accumulateChatUsage(usage, chatResult);

  parsed = parsePersonaSynthesisJson(chatResult.text);
  if (!parsed.success) {
    throw new PersonaSynthesisError(
      `Persona synthesis output failed validation: ${formatSynthesisValidationErrors(parsed.error)}`,
    );
  }

  return {
    synthesis: parsed.data,
    qualifiedModel: chatResult.qualifiedModel,
  };
}

export async function generatePersona(
  contactId: string,
  opts?: GeneratePersonaOptions,
): Promise<GeneratePersonaResult> {
  const prepared = preparePersonaGeneration(contactId, { force: opts?.force });
  if (prepared.kind === "skip") {
    return {
      generated: false,
      skipped: true,
      reason: prepared.reason,
      personaId: prepared.personaId,
    };
  }

  return runStructuredSynthesis(contactId, prepared, opts);
}

export async function runStructuredSynthesis(
  contactId: string,
  prepared: Extract<PreparedPersonaGeneration, { kind: "ready" }>,
  opts?: GeneratePersonaOptions,
): Promise<Extract<GeneratePersonaResult, { generated: true }>> {
  const { activePersona, bundle } = prepared;

  const now = Math.floor(Date.now() / 1000);
  const workflowRun = createWorkflowRun({
    workflowType: "persona",
    status: "running",
    trigger: opts?.trigger ?? "user",
    config: JSON.stringify({
      contactId,
      force: opts?.force ?? false,
      promptVersion: PERSONA_PROMPT_VERSION,
    }),
    startedAt: now,
    parentWorkflowId: opts?.parentWorkflowId ?? null,
  });

  let accruedInputTokens = 0;
  let accruedOutputTokens = 0;
  const chatUsage = { inputTokens: 0, outputTokens: 0 };

  try {
    const evidencePrompt = renderPersonaEvidencePrompt(bundle.evidence);
    const { synthesis, qualifiedModel } = await synthesizePersonaOutput(
      evidencePrompt,
      opts?.fetchImpl ?? fetch,
      opts?.env ?? process.env,
      chatUsage,
    );
    accruedInputTokens = chatUsage.inputTokens;
    accruedOutputTokens = chatUsage.outputTokens;

    const persisted = await persistPersonaSynthesis({
      contactId,
      synthesis,
      bundle,
      activePersona,
      qualifiedModel,
      workflowRunId: workflowRun.id,
      sourceWindowExtras: { generator: "workflow" },
      fetchImpl: opts?.fetchImpl,
      env: opts?.env,
    });

    updateWorkflowRun(workflowRun.id, {
      status: "completed",
      model: qualifiedModel,
      inputTokens: accruedInputTokens,
      outputTokens: accruedOutputTokens,
      result: JSON.stringify({
        personaId: persisted.persona.id,
        evidenceHash: bundle.provenance.evidenceHash,
        supersededPersonaId: activePersona?.id ?? null,
      }),
      completedAt: Math.floor(Date.now() / 1000),
      errors: JSON.stringify(persisted.embedErrors),
    });

    return {
      generated: true,
      persona: persisted.persona,
      workflowRunId: workflowRun.id,
      supersededPersonaId: activePersona?.id ?? null,
      nicheEdgesUpserted: persisted.nicheEdgesUpserted,
      embedded: persisted.embedded,
    };
  } catch (error) {
    accruedInputTokens = chatUsage.inputTokens;
    accruedOutputTokens = chatUsage.outputTokens;
    const message = error instanceof Error ? error.message : "Persona generation failed";
    updateWorkflowRun(workflowRun.id, {
      status: "failed",
      inputTokens: accruedInputTokens,
      outputTokens: accruedOutputTokens,
      errors: JSON.stringify([message]),
      completedAt: Math.floor(Date.now() / 1000),
    });
    throw error;
  }
}
