import { describe, expect, it } from "vitest";
import {
  buildAgentPrompt,
  buildUpsertPersonaInput,
  createPrepareMetadata,
  metaPathForPrompt,
  parseSynthesisResponseFile,
  readPersonaAgentJobMeta,
  resolveMetaPath,
} from "@/lib/qa/persona-agent-job-smoke-lib";
import {
  formatSynthesisValidationErrors,
  parsePersonaSynthesisJson,
  PERSONA_PROMPT_VERSION,
} from "@/lib/persona/synthesis";
import { hashPersonaEvidence } from "@/lib/db/queries/persona-evidence";
import type { PersonaEvidenceProvenance } from "@/lib/db/queries/persona-evidence";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    expect(prompt).toContain('"name": "Ada"');
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
