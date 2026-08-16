import { z } from "zod";

export const PERSONA_PROMPT_VERSION = 1;

export const personaSynthesisSchema = z.object({
  archetype: z.string().min(1).max(80),
  tone: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  description: z.string().min(1).max(2000).optional(),
  interests: z.array(z.string().min(1).max(40)).max(12).default([]),
  conversionTriggers: z.array(z.string().min(1).max(80)).max(10).default([]),
  engagementFormats: z.array(z.string().min(1).max(40)).max(10).default([]),
  confidence: z.number().min(0).max(1),
});

export type PersonaSynthesisOutput = z.infer<typeof personaSynthesisSchema>;

export const PERSONA_SYSTEM_PROMPT = `You are a GTM persona analyst for a social relationship graph product.
Synthesize a contact persona ONLY from the evidence JSON provided by the user.
Never invent employers, follower counts, interests, or behaviors not supported by the evidence.

Return ONLY a single JSON object with these fields:
- archetype (string, max 80): short label like "Serial Consumer Tech Founder"
- tone (string, max 80): communication style like "Casual and supportive"
- summary (string, max 280): one-line persona headline for dashboards
- description (optional string, max 2000): fuller narrative when evidence supports it
- interests (array of strings, max 12): topical interests grounded in evidence
- conversionTriggers (array of strings, max 10): what motivates conversion
- engagementFormats (array of strings, max 10): preferred content formats
- confidence (number 0-1): calibrate to evidence depth — thin evidence ≤0.4, single platform ≤0.7, rich multi-surface up to 1.0

Do not wrap the JSON in markdown fences.`;

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const lines = trimmed.split("\n");
  lines.shift();
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === "```") {
    lines.pop();
  }
  return lines.join("\n").trim();
}

export function parsePersonaSynthesisJson(raw: string): z.SafeParseReturnType<unknown, PersonaSynthesisOutput> {
  const text = stripCodeFences(raw);
  try {
    const parsed: unknown = JSON.parse(text);
    return personaSynthesisSchema.safeParse(parsed);
  } catch {
    return personaSynthesisSchema.safeParse(undefined);
  }
}

export function formatSynthesisValidationErrors(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}
