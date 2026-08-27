import type { PersonaEvidenceBundle } from "@/lib/db/queries/persona-evidence";
import type { DbRunner } from "@/lib/db/client";
import { projectPersonaInterestsToNiches } from "@/lib/db/queries/persona-niches";
import {
  getActivePersona,
  upsertPersona,
  type SerializedContactPersona,
} from "@/lib/db/queries/personas";
import { embedNodeIfStale, EmbeddingUnavailableError } from "@/lib/embeddings/embed-node";
import {
  PERSONA_PROMPT_VERSION,
  type PersonaSynthesisOutput,
} from "@/lib/persona/synthesis";
import type { EnvLike } from "@/lib/rtx/env";

export type PersistPersonaSynthesisResult = {
  persona: SerializedContactPersona;
  nicheEdgesUpserted: number;
  embedded: boolean;
  embedErrors: string[];
};

export const DEFAULT_PERSONA_EMBED_TIMEOUT_MS = 30_000;

export type PersistPersonaSynthesisInput = {
  contactId: string;
  synthesis: PersonaSynthesisOutput;
  bundle: Pick<PersonaEvidenceBundle, "provenance">;
  activePersona: SerializedContactPersona | null;
  qualifiedModel: string;
  workflowRunId: string;
  sourceWindowExtras?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  embeddingTimeoutMs?: number;
};

export function persistPersonaSynthesisRecord(
  input: PersistPersonaSynthesisInput,
  runner?: DbRunner,
): SerializedContactPersona {
  const sourceWindow = {
    promptVersion: PERSONA_PROMPT_VERSION,
    evidenceHash: input.bundle.provenance.evidenceHash,
    identityIds: input.bundle.provenance.identityIds,
    metricSnapshotAt: input.bundle.provenance.metricSnapshotAt,
    contentItemIds: input.bundle.provenance.contentItemIds,
    interactionWindow: input.bundle.provenance.interactionWindow,
    orgIds: input.bundle.provenance.orgIds,
    nicheSlugs: input.bundle.provenance.nicheSlugs,
    assembledAt: input.bundle.provenance.assembledAt,
    ...input.sourceWindowExtras,
  };

  return upsertPersona(
    {
      contactId: input.contactId,
      archetype: input.synthesis.archetype,
      tone: input.synthesis.tone,
      summary: input.synthesis.summary,
      description: input.synthesis.description ?? null,
      interests: input.synthesis.interests,
      conversionTriggers: input.synthesis.conversionTriggers,
      engagementFormats: input.synthesis.engagementFormats,
      confidence: input.synthesis.confidence,
      scope: "shared",
      model: input.qualifiedModel,
      sourceWindow,
      workflowRunId: input.workflowRunId,
    },
    runner,
  );
}

export async function finishPersonaSynthesisPersistence(input: {
  persona: SerializedContactPersona;
  workflowRunId: string;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  embeddingTimeoutMs?: number;
}): Promise<Omit<PersistPersonaSynthesisResult, "persona">> {
  const persona = input.persona;

  const nicheResult = projectPersonaInterestsToNiches(
    persona,
    `persona:${input.workflowRunId}`,
  );

  const timeoutMs = Math.max(0, input.embeddingTimeoutMs ?? DEFAULT_PERSONA_EMBED_TIMEOUT_MS);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ embedded: false; embedErrors: string[] }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({
        embedded: false,
        embedErrors: [`Persona embedding timed out after ${timeoutMs}ms; the persona was saved.`],
      });
      // Settle the timeout branch before aborting so an AbortError cannot win the race.
      controller.abort();
    }, timeoutMs);
  });
  const embedding = embedNodeIfStale("contact", persona.contactId, "persona", {
    fetchImpl: input.fetchImpl,
    env: input.env,
    signal: controller.signal,
  })
    .then((embedResult) => ({ embedded: embedResult.embedded, embedErrors: [] as string[] }))
    .catch((error: unknown) => {
      if (error instanceof EmbeddingUnavailableError) {
        return { embedded: false as const, embedErrors: [error.message] };
      }
      throw error;
    });

  let embeddingResult: { embedded: boolean; embedErrors: string[] };
  try {
    embeddingResult = await Promise.race([embedding, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  return {
    nicheEdgesUpserted: nicheResult.edgesUpserted,
    embedded: embeddingResult.embedded,
    embedErrors: embeddingResult.embedErrors,
  };
}

export async function persistPersonaSynthesis(
  input: PersistPersonaSynthesisInput,
): Promise<PersistPersonaSynthesisResult> {
  const persona = persistPersonaSynthesisRecord(input);
  const derivatives = await finishPersonaSynthesisPersistence({
    persona,
    workflowRunId: input.workflowRunId,
    fetchImpl: input.fetchImpl,
    env: input.env,
    embeddingTimeoutMs: input.embeddingTimeoutMs,
  });

  const saved = getActivePersona(input.contactId, { includeLocalOnly: true });
  if (!saved) {
    throw new Error(`Persona write failed for contact: ${input.contactId}`);
  }

  return {
    persona: saved,
    ...derivatives,
  };
}
