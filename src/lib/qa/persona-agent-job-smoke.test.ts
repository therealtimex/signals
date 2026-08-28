import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
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
import {
  formatSynthesisValidationErrors,
  parsePersonaSynthesisJson,
  PERSONA_PROMPT_VERSION,
} from "@/lib/persona/synthesis";
import { hashPersonaEvidence } from "@/lib/db/queries/persona-evidence";
import type { PersonaEvidenceProvenance } from "@/lib/db/queries/persona-evidence";
import { PERSONA_AGENT_PROMPT_VERSION } from "@/lib/persona/agent-job/prompt";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const sampleProvenance = (): PersonaEvidenceProvenance => ({
  identityIds: ["id-1"],
  metricSnapshotAt: { "id-1": 100 },
  contentItemIds: ["content-1"],
  interactionWindow: { sharedCount: 2, from: 10, to: 20 },
  orgIds: ["org-1"],
  nicheSlugs: ["founders"],
  evidenceHash: "abc123",
  assembledAt: 1_700_000_000,
});

const validSynthesis = {
  archetype: "Founder",
  tone: "Direct",
  summary: "Builds in public",
  interests: ["devtools"],
  conversionTriggers: ["proof"],
  engagementFormats: ["threads"],
  confidence: 0.7,
};

describe("persona-agent-job-smoke-lib", () => {
  it("buildAgentPrompt includes versioned system instructions and evidence", () => {
    const prompt = buildAgentPrompt({
      jobId: "job-1",
      contactId: "contact-1",
      evidence: { contact: { name: "Ada" } },
    });
    expect(prompt).toContain("jobId: job-1");
    expect(prompt).toContain(`promptVersion: ${PERSONA_PROMPT_VERSION}`);
    expect(prompt).toContain(`agentPromptVersion: ${PERSONA_AGENT_PROMPT_VERSION}`);
    expect(PERSONA_AGENT_PROMPT_VERSION).toBe(2);
    expect(prompt).toContain(
      "SIGNALS_BASE_URL=http://127.0.0.1:3000 signals-pp-cli agent-tools invoke --agent --stdin",
    );
    expect(prompt).toContain(
      '\"tool\":\"complete_persona_job\",\"input\":{\"jobId\":\"job-1\"',
    );
    expect(prompt).toContain(
      "Do not run `resolve-base-url.sh` or `invoke-tool.sh` while `signals-pp-cli` is available.",
    );
    expect(prompt).toContain('"name": "Ada"');
  });

  it("keeps provisioned persona callback guidance CLI-first", () => {
    const skill = fs.readFileSync(
      path.join(repoRoot, ".claude/skills/realtimex-signals/SKILL.md"),
      "utf8",
    );
    const workspaceGuide = fs.readFileSync(
      path.join(repoRoot, "realtimex-plugin/templates/signals/AGENTS.md"),
      "utf8",
    );

    expect(skill).toContain("run-signals-pp-cli.sh agent-tools invoke --agent");
    expect(skill).toContain("Automated persona callbacks");
    expect(workspaceGuide).toContain("run-signals-pp-cli.sh health");
    expect(workspaceGuide).toContain("npx @realtimex/signals-pp-cli@<cliVersion>");
    expect(workspaceGuide).not.toContain("run `scripts/resolve-base-url.sh`");
  });

  it("parseSynthesisResponseFile rejects null fields the production schema rejects", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-smoke-"));
    const responsePath = path.join(dir, "response.json");
    fs.writeFileSync(
      responsePath,
      JSON.stringify({
        ...validSynthesis,
        description: null,
        interests: null,
        conversionTriggers: null,
        engagementFormats: null,
      }),
    );

    const zodResult = parsePersonaSynthesisJson(fs.readFileSync(responsePath, "utf8"));
    expect(zodResult.success).toBe(false);

    expect(() => parseSynthesisResponseFile(responsePath)).toThrow(
      /Persona synthesis output failed validation/,
    );
    if (!zodResult.success) {
      expect(formatSynthesisValidationErrors(zodResult.error)).toContain("description");
    }
  });

  it("buildUpsertPersonaInput omits description when synthesis omits it", () => {
    const meta = createPrepareMetadata({
      jobId: "job-1",
      contactId: "contact-1",
      baseUrl: "http://127.0.0.1:3010",
      provenance: sampleProvenance(),
    });

    const input = validateUpsertPersonaInput(
      buildUpsertPersonaInput({
        contactId: "contact-1",
        synthesis: validSynthesis,
        meta,
      }),
    );

    expect(input).not.toHaveProperty("description");
  });

  it("resolveApplyBaseUrl prefers explicit override then prepare metadata", () => {
    const meta = createPrepareMetadata({
      jobId: "job-1",
      contactId: "contact-1",
      baseUrl: "http://127.0.0.1:3010",
      provenance: sampleProvenance(),
    });

    expect(resolveApplyBaseUrl(meta)).toBe("http://127.0.0.1:3010");
    expect(resolveApplyBaseUrl(meta, "http://127.0.0.1:3999")).toBe("http://127.0.0.1:3999");
  });

  it("wrapper verify subprocess resolves imports and validates JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-smoke-cli-"));
    const responsePath = path.join(dir, "response.json");
    fs.writeFileSync(responsePath, JSON.stringify(validSynthesis));
    const output = execFileSync(
      "bash",
      ["scripts/qa/run-persona-agent-job-smoke.sh", "verify", "--response", responsePath],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(output).toContain("Response JSON is valid");
  });

  it("apply uses prepare-time provenance instead of refreshing evidence", () => {
    const meta = createPrepareMetadata({
      jobId: "job-1",
      contactId: "contact-1",
      baseUrl: "http://127.0.0.1:3000",
      provenance: sampleProvenance(),
    });

    const input = buildUpsertPersonaInput({
      contactId: "contact-1",
      synthesis: validSynthesis,
      meta,
    });

    const sourceWindow = input.sourceWindow as Record<string, unknown>;
    expect(sourceWindow.evidenceHash).toBe("abc123");
    expect(sourceWindow.assembledAt).toBe(1_700_000_000);
    expect(sourceWindow.identityIds).toEqual(["id-1"]);
    expect(sourceWindow.jobId).toBe("job-1");
  });

  it("readPersonaAgentJobMeta validates contactId and jobId", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persona-smoke-"));
    const metaPath = path.join(dir, "job.meta.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        createPrepareMetadata({
          jobId: "job-1",
          contactId: "contact-1",
          baseUrl: "http://127.0.0.1:3000",
          provenance: sampleProvenance(),
        }),
      ),
    );

    expect(() =>
      readPersonaAgentJobMeta(metaPath, { contactId: "contact-2" }),
    ).toThrow(/does not match/);
    expect(() =>
      readPersonaAgentJobMeta(metaPath, { contactId: "contact-1", jobId: "job-2" }),
    ).toThrow(/jobId/);

    const loaded = readPersonaAgentJobMeta(metaPath, {
      contactId: "contact-1",
      jobId: "job-1",
    });
    expect(loaded.provenance.evidenceHash).toBe("abc123");
  });

  it("resolveMetaPath prefers explicit meta and derives from prompt path", () => {
    expect(resolveMetaPath({ meta: "/tmp/job.meta.json" })).toBe("/tmp/job.meta.json");
    expect(resolveMetaPath({ prompt: "/tmp/job.txt" })).toBe("/tmp/job.txt.meta.json");
    expect(metaPathForPrompt("/tmp/job.txt")).toBe("/tmp/job.txt.meta.json");
    expect(() => resolveMetaPath({ response: "/tmp/resp.json" })).toThrow(
      /--meta|--prompt/,
    );
  });

  it("hashPersonaEvidence matches canonical evidence identity used at prepare time", () => {
    const evidence = {
      contact: {
        name: "Ada",
        title: null,
        company: null,
        location: null,
        bio: null,
      },
      identities: [],
      content: [],
      interactions: [],
      org: null,
      niches: [],
    };
    expect(hashPersonaEvidence(evidence)).toHaveLength(64);
  });
});
