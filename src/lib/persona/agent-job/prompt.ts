import {
  PERSONA_PROMPT_VERSION,
  PERSONA_SYSTEM_PROMPT,
} from "@/lib/persona/synthesis";

export const PERSONA_AGENT_PROMPT_VERSION = 1;

export function buildPersonaAgentJobBrief(input: {
  jobId: string;
  contactId: string;
  baseUrl?: string;
  promptVersion?: number;
  agentPromptVersion?: number;
  systemPrompt?: string;
  evidence: unknown;
}): string {
  const promptVersion = input.promptVersion ?? PERSONA_PROMPT_VERSION;
  const agentPromptVersion = input.agentPromptVersion ?? PERSONA_AGENT_PROMPT_VERSION;
  const systemPrompt = input.systemPrompt ?? PERSONA_SYSTEM_PROMPT;
  const baseUrl = input.baseUrl?.trim() || "http://127.0.0.1:3000";
  const evidenceJson = JSON.stringify(input.evidence, null, 2);

  return `# Persona synthesis job

You are executing **one isolated persona synthesis job** for Signals CRM.

## Job metadata
- jobId: ${input.jobId}
- contactId: ${input.contactId}
- promptVersion: ${promptVersion}
- agentPromptVersion: ${agentPromptVersion}
- Signals base URL: ${baseUrl}

## Rules
1. Use **only** the evidence JSON below. Do not invent employers, metrics, interests, or behaviors.
2. This job is **stateless**. Ignore all prior messages and prior contacts.
3. Produce only a single JSON object matching the schema below. Do not add markdown fences or commentary.
4. Do not call any Signals agent-tool to read evidence or write the persona. When your JSON is ready, call **\`complete_persona_job\`** exactly once with \`{ jobId, success: true, synthesis }\`. If it returns validation errors, correct the JSON and call it again (at most once more). If you cannot produce a persona, call it with \`{ jobId, success: false, error }\`.
5. Load the \`realtimex-signals\` skill for the agent-tools API at ${baseUrl}.
6. Optionally include \`model\` (for example \`claude:claude-fable-5\`) so Signals can record provenance.

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
