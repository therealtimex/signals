import type { PersonaEvidenceBundle } from "@/lib/db/queries/persona-evidence";
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

export async function persistPersonaSynthesis(input: {
  contactId: string;
  synthesis: PersonaSynthesisOutput;
  bundle: Pick<PersonaEvidenceBundle, "provenance">;
  activePersona: SerializedContactPersona | null;
  qualifiedModel: string;
  workflowRunId: string;
  sourceWindowExtras?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  env?: EnvLike;
}): Promise<PersistPersonaSynthesisResult> {
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

  const persona = upsertPersona({
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
  });

  const nicheResult = projectPersonaInterestsToNiches(
    persona,
    `persona:${input.workflowRunId}`,
  );

  let embedded = false;
  const embedErrors: string[] = [];
  try {
    const embedResult = await embedNodeIfStale("contact", input.contactId, "persona", {
      fetchImpl: input.fetchImpl,
      env: input.env,
    });
    embedded = embedResult.embedded;
  } catch (error) {
    if (error instanceof EmbeddingUnavailableError) {
      embedErrors.push(error.message);
    } else {
      throw error;
    }
  }

  const saved = getActivePersona(input.contactId, { includeLocalOnly: true });
  if (!saved) {
    throw new Error(`Persona write failed for contact: ${input.contactId}`);
  }

  return {
    persona: saved,
    nicheEdgesUpserted: nicheResult.edgesUpserted,
    embedded,
    embedErrors,
  };
}
