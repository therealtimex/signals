import fs from "node:fs";
import {
  PERSONA_PROMPT_VERSION,
  PERSONA_SYSTEM_PROMPT,
  formatSynthesisValidationErrors,
  parsePersonaSynthesisJson,
  type PersonaSynthesisOutput,
} from "@/lib/persona/synthesis";
import type { PersonaEvidenceProvenance } from "@/lib/db/queries/persona-evidence";
import { upsertPersonaSchema } from "@/lib/agent-tools/schemas";

export type PersonaAgentJobMeta = {
  jobId: string;
  contactId: string;
  baseUrl: string;
  promptVersion: number;
  preparedAt: string;
  provenance: PersonaEvidenceProvenance;
};

export function buildAgentPrompt(input: {
  jobId: string;
  contactId: string;
  promptVersion?: number;
  systemPrompt?: string;
  evidence: unknown;
}): string {
  const promptVersion = input.promptVersion ?? PERSONA_PROMPT_VERSION;
  const systemPrompt = input.systemPrompt ?? PERSONA_SYSTEM_PROMPT;
  const evidenceJson = JSON.stringify(input.evidence, null, 2);

  return `# Persona synthesis job

You are executing **one isolated persona synthesis job** for Signals CRM.

## Job metadata
- jobId: ${input.jobId}
- contactId: ${input.contactId}
- promptVersion: ${promptVersion}

## Rules
1. Use **only** the evidence JSON below. Do not invent employers, metrics, interests, or behaviors.
2. This job is **stateless**. Ignore all prior messages and prior contacts.
3. Return **only** a single JSON object matching the schema below. No markdown fences, no commentary, no tool calls.
4. Do not call Signals agent-tools in this job. Signals will persist the result.

## Output schema (required fields)
{
  "archetype": "string, max 80",
  "tone": "string, max 80",
  "summary": "string, max 280",
  "description": "string, max 2000 (optional)",
  "interests": ["string, max 12 items"],
  "conversionTriggers": ["string, max 10 items"],
  "engagementFormats": ["string, max 10 items"],
  "confidence": 0.0
}

### Confidence calibration
- thin evidence → ≤ 0.4
- single platform → ≤ 0.7
- rich multi-surface evidence → up to 1.0

## System analyst instructions
${systemPrompt}

## Evidence JSON
${evidenceJson}
`;
}

export function metaPathForPrompt(promptPath: string): string {
  return `${promptPath}.meta.json`;
}

export function resolveMetaPath(args: {
  meta?: string;
  prompt?: string;
  response?: string;
}): string {
  if (args.meta) {
    return args.meta;
  }
  if (args.prompt) {
    return metaPathForPrompt(args.prompt);
  }
  throw new Error(
    "apply requires --meta <prepare sidecar> or --prompt <prepare output path>",
  );
}

export function readPersonaAgentJobMeta(
  metaPath: string,
  expected: { contactId: string; jobId?: string },
): PersonaAgentJobMeta {
  const raw = fs.readFileSync(metaPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<PersonaAgentJobMeta>;

  if (!parsed.jobId || !parsed.contactId || !parsed.provenance?.evidenceHash) {
    throw new Error(
      `Invalid prepare metadata in ${metaPath}: expected jobId, contactId, and provenance.evidenceHash`,
    );
  }

  if (parsed.contactId !== expected.contactId) {
    throw new Error(
      `Metadata contactId ${parsed.contactId} does not match --contact-id ${expected.contactId}`,
    );
  }

  if (expected.jobId && parsed.jobId !== expected.jobId) {
    throw new Error(
      `Metadata jobId ${parsed.jobId} does not match --job-id ${expected.jobId}`,
    );
  }

  return {
    jobId: parsed.jobId,
    contactId: parsed.contactId,
    baseUrl: parsed.baseUrl ?? "http://127.0.0.1:3000",
    promptVersion: parsed.promptVersion ?? PERSONA_PROMPT_VERSION,
    preparedAt: parsed.preparedAt ?? new Date(0).toISOString(),
    provenance: parsed.provenance,
  };
}

export function parseSynthesisResponseFile(responsePath: string): PersonaSynthesisOutput {
  const raw = fs.readFileSync(responsePath, "utf8");
  const parsed = parsePersonaSynthesisJson(raw);
  if (!parsed.success) {
    throw new Error(
      `Persona synthesis output failed validation: ${formatSynthesisValidationErrors(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function resolveApplyBaseUrl(
  meta: PersonaAgentJobMeta,
  override?: string,
): string {
  return (
    override?.trim() ||
    meta.baseUrl ||
    process.env.SIGNALS_BASE_URL ||
    "http://127.0.0.1:3000"
  );
}

export function buildUpsertPersonaInput(input: {
  contactId: string;
  synthesis: PersonaSynthesisOutput;
  meta: PersonaAgentJobMeta;
}): Record<string, unknown> {
  const { provenance } = input.meta;

  const payload: Record<string, unknown> = {
    contactId: input.contactId,
    scope: "shared",
    archetype: input.synthesis.archetype,
    tone: input.synthesis.tone,
    summary: input.synthesis.summary,
    interests: input.synthesis.interests,
    conversionTriggers: input.synthesis.conversionTriggers,
    engagementFormats: input.synthesis.engagementFormats,
    confidence: input.synthesis.confidence,
    model: "terminal-agent:persona-agent-job-smoke",
    sourceWindow: {
      trigger: "agent-manual-test",
      generator: "terminal-agent-smoke",
      jobId: input.meta.jobId,
      promptVersion: input.meta.promptVersion,
      evidenceHash: provenance.evidenceHash,
      identityIds: provenance.identityIds,
      metricSnapshotAt: provenance.metricSnapshotAt,
      contentItemIds: provenance.contentItemIds,
      interactionWindow: provenance.interactionWindow,
      orgIds: provenance.orgIds,
      nicheSlugs: provenance.nicheSlugs,
      assembledAt: provenance.assembledAt,
      preparedAt: input.meta.preparedAt,
    },
  };

  if (input.synthesis.description !== undefined) {
    payload.description = input.synthesis.description;
  }

  return payload;
}

export function validateUpsertPersonaInput(input: Record<string, unknown>): Record<string, unknown> {
  const parsed = upsertPersonaSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `upsert_persona payload failed validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

export function createPrepareMetadata(input: {
  jobId: string;
  contactId: string;
  baseUrl: string;
  provenance: PersonaEvidenceProvenance;
  promptVersion?: number;
}): PersonaAgentJobMeta {
  return {
    jobId: input.jobId,
    contactId: input.contactId,
    baseUrl: input.baseUrl,
    promptVersion: input.promptVersion ?? PERSONA_PROMPT_VERSION,
    preparedAt: new Date().toISOString(),
    provenance: input.provenance,
  };
}
