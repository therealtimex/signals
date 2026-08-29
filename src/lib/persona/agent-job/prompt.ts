import {
  PERSONA_PROMPT_VERSION,
  PERSONA_SYSTEM_PROMPT,
} from "@/lib/persona/synthesis";

export const PERSONA_AGENT_PROMPT_VERSION = 2;

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
3. Build a single JSON object matching the schema below. Do not add markdown fences or commentary to the synthesis.
4. Do not call any Signals agent-tool to read evidence or write the persona. Submit the finished synthesis through the bundled CLI, not a workspace-relative shell helper. Run \`SIGNALS_BASE_URL=${baseUrl} signals-pp-cli agent-tools invoke --agent --stdin\` and pass this JSON envelope on stdin, replacing the synthesis placeholder with your object: \`{"tool":"complete_persona_job","input":{"jobId":"${input.jobId}","success":true,"synthesis":<the synthesis object>}}\`.
5. If the callback returns validation errors, correct the synthesis and call it again at most once. If you cannot produce a persona, use the same CLI command with \`{"tool":"complete_persona_job","input":{"jobId":"${input.jobId}","success":false,"error":"<reason>"}}\`, replacing the reason placeholder.
6. Load the \`realtimex-signals\` skill for the callback contract. Do not run \`resolve-base-url.sh\` or \`invoke-tool.sh\` while \`signals-pp-cli\` is available.
7. Optionally include \`model\` (for example \`claude:claude-fable-5\`) so Signals can record provenance.
8. After \`complete_persona_job\` succeeds or fails terminally, Signals schedules release of this terminal session when no other persona jobs are active on it — do not continue working in this thread after submission.

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
