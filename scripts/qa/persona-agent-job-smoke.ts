#!/usr/bin/env node
/**
 * PersonaAgentJob manual smoke helper (#317).
 */
import fs from "node:fs";
import {
  buildAgentPrompt,
  buildUpsertPersonaInput,
  createPrepareMetadata,
  metaPathForPrompt,
  parseSynthesisResponseFile,
  readPersonaAgentJobMeta,
  resolveApplyBaseUrl,
  resolveMetaPath,
  validateUpsertPersonaInput,
} from "@/lib/qa/persona-agent-job-smoke-lib";
import { PERSONA_PROMPT_VERSION, PERSONA_SYSTEM_PROMPT } from "@/lib/persona/synthesis";
import type { PersonaEvidenceBundle } from "@/lib/db/queries/persona-evidence";

function usage(): void {
  console.log(`Usage:
  scripts/qa/run-persona-agent-job-smoke.sh prepare \\
    --contact-id <id> --out FILE [--base-url URL] [--job-id ID]

  scripts/qa/run-persona-agent-job-smoke.sh verify \\
    --response FILE

  scripts/qa/run-persona-agent-job-smoke.sh apply \\
    --contact-id <id> --response FILE \\
    [--meta FILE | --prompt FILE] [--base-url URL] [--job-id ID] [--dry-run]

Environment:
  SIGNALS_BASE_URL           Default base URL (http://127.0.0.1:3000)
  SIGNALS_AGENT_TOOL_TOKEN   Bearer token when API is not localhost-only
`);
}

type ParsedArgs = Record<string, string | boolean | string[]> & { _?: string[] };

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
      continue;
    }
    (args._ as string[]).push(token);
  }
  return args;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.SIGNALS_AGENT_TOOL_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function invokeTool(
  baseUrl: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent-tools/invoke`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool, input }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    code?: string;
    error?: string;
    result?: unknown;
  };
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} invoking ${tool}: ${JSON.stringify(body)}`);
  }
  if (!body.success) {
    throw new Error(
      `Tool ${tool} failed (${body.code ?? "unknown"}): ${body.error ?? JSON.stringify(body)}`,
    );
  }
  return body.result;
}

async function cmdPrepare(args: ParsedArgs): Promise<void> {
  const contactId = args.contactId as string | undefined;
  if (!contactId) {
    throw new Error("prepare requires --contact-id");
  }
  const baseUrl =
    (args.baseUrl as string | undefined) ||
    process.env.SIGNALS_BASE_URL ||
    "http://127.0.0.1:3000";
  const jobId = (args.jobId as string | undefined) || `persona-job-${Date.now()}`;

  const bundle = (await invokeTool(baseUrl, "get_persona_evidence", {
    contactId,
  })) as PersonaEvidenceBundle;

  if (!bundle.provenance?.evidenceHash) {
    throw new Error("get_persona_evidence did not return provenance.evidenceHash");
  }

  const prompt = buildAgentPrompt({
    jobId,
    contactId,
    promptVersion: PERSONA_PROMPT_VERSION,
    systemPrompt: PERSONA_SYSTEM_PROMPT,
    evidence: bundle.evidence,
  });

  const meta = createPrepareMetadata({
    jobId,
    contactId,
    baseUrl,
    provenance: bundle.provenance,
    promptVersion: PERSONA_PROMPT_VERSION,
  });

  const out = args.out as string | undefined;
  if (!out) {
    throw new Error("prepare requires --out <file> to write the prompt and metadata sidecar");
  }

  fs.writeFileSync(out, prompt, "utf8");
  const metaPath = metaPathForPrompt(out);
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  console.log(`Wrote prompt: ${out}`);
  console.log(`Wrote meta:   ${metaPath}`);

  console.error("");
  console.error("Next steps:");
  console.error("  1. Start a fresh RTX terminal-agent session (no prior contact context).");
  console.error("  2. Paste the prompt and wait for JSON-only output.");
  console.error("  3. Save response, then run:");
  console.error(
    `     scripts/qa/run-persona-agent-job-smoke.sh verify --response /path/to/response.json`,
  );
  console.error(
    `     scripts/qa/run-persona-agent-job-smoke.sh apply --contact-id ${contactId} --response /path/to/response.json --prompt ${out}`,
  );
}

async function cmdVerify(args: ParsedArgs): Promise<void> {
  const responsePath = args.response as string | undefined;
  if (!responsePath) {
    throw new Error("verify requires --response");
  }
  const parsed = parseSynthesisResponseFile(responsePath);
  console.log("Response JSON is valid.");
  console.log(JSON.stringify(parsed, null, 2));
}

async function cmdApply(args: ParsedArgs): Promise<void> {
  const contactId = args.contactId as string | undefined;
  const responsePath = args.response as string | undefined;
  if (!contactId || !responsePath) {
    throw new Error("apply requires --contact-id and --response");
  }

  const jobId = args.jobId as string | undefined;
  const metaPath = resolveMetaPath({
    meta: args.meta as string | undefined,
    prompt: args.prompt as string | undefined,
    response: responsePath,
  });
  const meta = readPersonaAgentJobMeta(metaPath, { contactId, jobId });
  const baseUrl = resolveApplyBaseUrl(meta, args.baseUrl as string | undefined);
  const synthesis = parseSynthesisResponseFile(responsePath);
  const input = validateUpsertPersonaInput(
    buildUpsertPersonaInput({ contactId, synthesis, meta }),
  );

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args._?.length) {
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
