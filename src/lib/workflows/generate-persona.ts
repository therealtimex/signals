import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import {
  assemblePersonaEvidence,
  renderPersonaEvidencePrompt,
} from "@/lib/db/queries/persona-evidence";
import {
  PersonaGenerationUnavailableError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import { projectPersonaInterestsToNiches } from "@/lib/db/queries/persona-niches";
import {
  getActivePersona,
  upsertPersona,
  type SerializedContactPersona,
} from "@/lib/db/queries/personas";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { embedNodeIfStale, EmbeddingUnavailableError } from "@/lib/embeddings/embed-node";
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

function parseSourceWindow(raw: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

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
  const contact = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (!contact) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  const activePersona = getActivePersona(contactId, { includeLocalOnly: true });
  if (activePersona?.scope === "local_only") {
    throw new PersonaScopeError(
      "Cannot generate a shared persona while an active local_only persona exists — re-scope via upsert_persona first",
    );
  }

  const bundle = assemblePersonaEvidence(contactId);

  if (
    !opts?.force &&
    activePersona &&
    parseSourceWindow(activePersona.sourceWindow).evidenceHash === bundle.provenance.evidenceHash
  ) {
    return {
      generated: false,
      skipped: true,
      reason: "evidence_unchanged",
      personaId: activePersona.id,
    };
  }

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

    const sourceWindow = {
      promptVersion: PERSONA_PROMPT_VERSION,
      generator: "workflow",
      evidenceHash: bundle.provenance.evidenceHash,
      identityIds: bundle.provenance.identityIds,
      metricSnapshotAt: bundle.provenance.metricSnapshotAt,
      contentItemIds: bundle.provenance.contentItemIds,
      interactionWindow: bundle.provenance.interactionWindow,
      orgIds: bundle.provenance.orgIds,
      nicheSlugs: bundle.provenance.nicheSlugs,
      assembledAt: bundle.provenance.assembledAt,
    };

    const persona = upsertPersona({
      contactId,
      archetype: synthesis.archetype,
      tone: synthesis.tone,
      summary: synthesis.summary,
      description: synthesis.description ?? null,
      interests: synthesis.interests,
      conversionTriggers: synthesis.conversionTriggers,
      engagementFormats: synthesis.engagementFormats,
      confidence: synthesis.confidence,
      scope: "shared",
      model: qualifiedModel,
      sourceWindow,
      workflowRunId: workflowRun.id,
    });

    const nicheResult = projectPersonaInterestsToNiches(persona, `persona:${workflowRun.id}`);

    let embedded = false;
    const embedErrors: string[] = [];
    try {
      const embedResult = await embedNodeIfStale("contact", contactId, "persona", {
        fetchImpl: opts?.fetchImpl,
        env: opts?.env,
      });
      embedded = embedResult.embedded;
    } catch (error) {
      if (error instanceof EmbeddingUnavailableError) {
        embedErrors.push(error.message);
      } else {
        throw error;
      }
    }

    updateWorkflowRun(workflowRun.id, {
      status: "completed",
      model: qualifiedModel,
      inputTokens: accruedInputTokens,
      outputTokens: accruedOutputTokens,
      result: JSON.stringify({
        personaId: persona.id,
        evidenceHash: bundle.provenance.evidenceHash,
        supersededPersonaId: activePersona?.id ?? null,
      }),
      completedAt: Math.floor(Date.now() / 1000),
      errors: JSON.stringify(embedErrors),
    });

    const saved = getActivePersona(contactId, { includeLocalOnly: true });
    if (!saved) {
      throw new Error(`Persona write failed for contact: ${contactId}`);
    }

    return {
      generated: true,
      persona: saved,
      workflowRunId: workflowRun.id,
      supersededPersonaId: activePersona?.id ?? null,
      nicheEdgesUpserted: nicheResult.edgesUpserted,
      embedded,
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
