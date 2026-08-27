#!/usr/bin/env node
/**
 * PersonaAgentJob manual smoke helper (#317).
 * Prepares a stateless per-contact agent prompt from live evidence, and optionally
 * validates/applies a structured JSON response via upsert_persona.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SYNTHESIS_PATH = path.join(ROOT, "src/lib/persona/synthesis.ts");

function usage() {
  console.log(`Usage:
  node scripts/qa/persona-agent-job-smoke.mjs prepare \\
    --contact-id <id> [--base-url URL] [--job-id ID] [--out FILE]

  node scripts/qa/persona-agent-job-smoke.mjs verify \\
    --response FILE

  node scripts/qa/persona-agent-job-smoke.mjs apply \\
    --contact-id <id> --response FILE [--base-url URL] [--job-id ID] [--dry-run]

Environment:
  SIGNALS_BASE_URL           Default base URL (http://127.0.0.1:3000)
  SIGNALS_AGENT_TOOL_TOKEN   Bearer token when API is not localhost-only

Examples:
  # 1) Build prompt for a contact
  node scripts/qa/persona-agent-job-smoke.mjs prepare --contact-id abc123 --out /tmp/persona-job.txt

  # 2) After pasting agent JSON to /tmp/persona-response.json
  node scripts/qa/persona-agent-job-smoke.mjs verify --response /tmp/persona-response.json
  node scripts/qa/persona-agent-job-smoke.mjs apply --contact-id abc123 --response /tmp/persona-response.json
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
      continue;
    }
    args._.push(token);
  }
  return args;
}

function loadPersonaPromptConstants() {
  const source = fs.readFileSync(SYNTHESIS_PATH, "utf8");
  const versionMatch = source.match(
    /export const PERSONA_PROMPT_VERSION = (\d+);/,
  );
  const promptMatch = source.match(
    /export const PERSONA_SYSTEM_PROMPT = `([\s\S]*?)`;/,
  );
  if (!versionMatch || !promptMatch) {
    throw new Error(
      `Could not read PERSONA_* constants from ${SYNTHESIS_PATH}`,
    );
  }
  return {
    promptVersion: Number(versionMatch[1]),
    systemPrompt: promptMatch[1],
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function hashEvidence(evidence) {
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = process.env.SIGNALS_AGENT_TOOL_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function invokeTool(baseUrl, tool, input) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent-tools/invoke`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool, input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} invoking ${tool}: ${JSON.stringify(body)}`,
    );
  }
  if (!body.success) {
    throw new Error(
      `Tool ${tool} failed (${body.code ?? "unknown"}): ${body.error ?? JSON.stringify(body)}`,
    );
  }
  return body.result;
}

function buildAgentPrompt({
  jobId,
  contactId,
  promptVersion,
  systemPrompt,
  evidence,
}) {
  const evidenceJson = JSON.stringify(evidence, null, 2);
  return `# Persona synthesis job

You are executing **one isolated persona synthesis job** for Signals CRM.

## Job metadata
- jobId: ${jobId}
- contactId: ${contactId}
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

function stripCodeFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split("\n");
  lines.shift();
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === "```") {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function validateSynthesis(parsed) {
  const errors = [];
  const requireString = (field, max) => {
    const value = parsed[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${field} must be a non-empty string`);
      return;
    }
    if (value.length > max) {
      errors.push(`${field} must be at most ${max} characters`);
    }
  };

  requireString("archetype", 80);
  requireString("tone", 80);
  requireString("summary", 280);
  if (parsed.description != null) {
    requireString("description", 2000);
  }

  for (const field of [
    "interests",
    "conversionTriggers",
    "engagementFormats",
  ]) {
    if (parsed[field] == null) {
      parsed[field] = [];
    }
    if (!Array.isArray(parsed[field])) {
      errors.push(`${field} must be an array`);
      continue;
    }
    const maxItems =
      field === "interests" ? 12 : field === "conversionTriggers" ? 10 : 10;
    const maxLen = field === "interests" || field === "engagementFormats" ? 40 : 80;
    if (parsed[field].length > maxItems) {
      errors.push(`${field} must have at most ${maxItems} items`);
    }
    for (const item of parsed[field]) {
      if (typeof item !== "string" || item.trim() === "") {
        errors.push(`${field} items must be non-empty strings`);
        break;
      }
      if (item.length > maxLen) {
        errors.push(`${field} items must be at most ${maxLen} characters`);
        break;
      }
    }
  }

  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return parsed;
}

function readResponseJson(responsePath) {
  const raw = fs.readFileSync(responsePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (error) {
    throw new Error(
      `Could not parse JSON from ${responsePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateSynthesis(parsed);
}

async function cmdPrepare(args) {
  const contactId = args.contactId;
  if (!contactId) {
    throw new Error("prepare requires --contact-id");
  }
  const baseUrl =
    args.baseUrl || process.env.SIGNALS_BASE_URL || "http://127.0.0.1:3000";
  const jobId = args.jobId || `persona-job-${Date.now()}`;
  const { promptVersion, systemPrompt } = loadPersonaPromptConstants();

  const bundle = await invokeTool(baseUrl, "get_persona_evidence", { contactId });
  const evidence = bundle.evidence;
  const provenance = bundle.provenance ?? {};
  const evidenceHash = hashEvidence(evidence);
  const prompt = buildAgentPrompt({
    jobId,
    contactId,
    promptVersion,
    systemPrompt,
    evidence,
  });

  const meta = {
    jobId,
    contactId,
    baseUrl,
    evidenceHash,
    assembledAt: provenance.assembledAt ?? null,
    promptVersion,
    preparedAt: new Date().toISOString(),
  };

  if (args.out) {
    fs.writeFileSync(args.out, prompt, "utf8");
    const metaPath = `${args.out}.meta.json`;
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    console.log(`Wrote prompt: ${args.out}`);
    console.log(`Wrote meta:   ${metaPath}`);
  } else {
    process.stdout.write(prompt);
  }

  console.error("");
  console.error("Next steps:");
  console.error("  1. Start a fresh RTX terminal-agent session (no prior contact context).");
  console.error("  2. Paste the prompt and wait for JSON-only output.");
  console.error(`  3. Save response, then run:`);
  console.error(
    `     node scripts/qa/persona-agent-job-smoke.mjs verify --response /path/to/response.json`,
  );
  console.error(
    `     node scripts/qa/persona-agent-job-smoke.mjs apply --contact-id ${contactId} --response /path/to/response.json --job-id ${jobId}`,
  );
}

async function cmdVerify(args) {
  const responsePath = args.response;
  if (!responsePath) {
    throw new Error("verify requires --response");
  }
  const parsed = readResponseJson(responsePath);
  console.log("Response JSON is valid.");
  console.log(JSON.stringify(parsed, null, 2));
}

async function cmdApply(args) {
  const contactId = args.contactId;
  const responsePath = args.response;
  if (!contactId || !responsePath) {
    throw new Error("apply requires --contact-id and --response");
  }
  const baseUrl =
    args.baseUrl || process.env.SIGNALS_BASE_URL || "http://127.0.0.1:3000";
  const jobId = args.jobId || `persona-job-${Date.now()}`;
  const parsed = readResponseJson(responsePath);
  const { promptVersion } = loadPersonaPromptConstants();

  let evidenceHash = null;
  let assembledAt = null;
  try {
    const bundle = await invokeTool(baseUrl, "get_persona_evidence", { contactId });
    evidenceHash = hashEvidence(bundle.evidence);
    assembledAt = bundle.provenance?.assembledAt ?? null;
  } catch (error) {
    console.error(
      `Warning: could not refresh evidence for sourceWindow (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const input = {
    contactId,
    scope: "shared",
    archetype: parsed.archetype,
    tone: parsed.tone,
    summary: parsed.summary,
    description: parsed.description,
    interests: parsed.interests,
    conversionTriggers: parsed.conversionTriggers,
    engagementFormats: parsed.engagementFormats,
    confidence: parsed.confidence,
    model: "terminal-agent:persona-agent-job-smoke",
    sourceWindow: {
      trigger: "agent-manual-test",
      jobId,
      promptVersion,
      ...(evidenceHash ? { evidenceHash } : {}),
      ...(assembledAt ? { assembledAt } : {}),
    },
  };

  if (args.dryRun) {
    console.log("Dry run — would call upsert_persona with:");
    console.log(JSON.stringify(input, null, 2));
    return;
  }

  const result = await invokeTool(baseUrl, "upsert_persona", input);
  console.log("upsert_persona succeeded.");
  console.log(JSON.stringify(result, null, 2));

  const persona = await invokeTool(baseUrl, "get_persona", { contactId });
  console.log("get_persona verification:");
  console.log(JSON.stringify(persona, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const command = args._[0];
  switch (command) {
    case "prepare":
      await cmdPrepare(args);
      break;
    case "verify":
      await cmdVerify(args);
      break;
    case "apply":
      await cmdApply(args);
      break;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
