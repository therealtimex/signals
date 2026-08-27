import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  handleCompletePersonaJob,
  handleGetPersonaJob,
} from "@/lib/agent-tools/persona-job-handlers";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { assemblePersonaEvidence } from "@/lib/db/queries/persona-evidence";
import {
  createPersonaJob,
  getPersonaJobById,
  markPersonaJobRunning,
  markPersonaJobTimedOut,
} from "@/lib/db/queries/persona-jobs";
import { getActivePersona } from "@/lib/db/queries/personas";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";

const validSynthesis = {
  archetype: "Product-minded Founder",
  tone: "Direct",
  summary: "Builds practical software in public",
  interests: ["developer tools"],
  conversionTriggers: ["working demos"],
  engagementFormats: ["technical threads"],
  confidence: 0.72,
};

const originalRtxAppId = process.env.RTX_APP_ID;

describe("PersonaAgentJob agent-tool handlers", () => {
  beforeEach(() => {
    resetCoreTables();
    delete process.env.RTX_APP_ID;
  });

  afterEach(() => {
    if (originalRtxAppId === undefined) delete process.env.RTX_APP_ID;
    else process.env.RTX_APP_ID = originalRtxAppId;
  });

  function seedRunningJob() {
    const contact = createContact({ name: `Persona Subject ${nanoid()}` });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: "persona-subject",
      isActive: 1,
    });
    const bundle = assemblePersonaEvidence(contact.id);
    const run = createWorkflowRun({
      workflowType: "persona",
      status: "running",
      trigger: "user",
    });
    const queued = createPersonaJob({
      id: `pa_${nanoid()}`,
      contactId: contact.id,
      trigger: "user",
      force: false,
      promptVersion: 1,
      agentPromptVersion: 1,
      evidenceHash: bundle.provenance.evidenceHash,
      provenance: bundle.provenance,
      supersededPersonaId: null,
      workflowRunId: run.id,
    });
    const job = markPersonaJobRunning(queued.id, {
      rtxWorkspaceSlug: "signals",
      rtxThreadSlug: `persona-${contact.id}`,
      rtxRuntimeSessionId: "",
      agentModel: "codex:gpt-5.6-sol",
    })!;
    return { contact, bundle, job, run };
  }

  it("returns one repair opportunity then fails the job and workflow", async () => {
    const { job, run } = seedRunningJob();

    const first = await handleCompletePersonaJob({
      jobId: job.id,
      success: true,
      synthesis: { summary: "missing required fields" },
    });
    expect(first).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      status: "running",
      details: { attemptsRemaining: 1 },
    });

    const second = await handleCompletePersonaJob({
      jobId: job.id,
      success: true,
      synthesis: "still not json",
    });
    expect(second).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      status: "failed",
      details: { attemptsRemaining: 0 },
    });
    expect(getPersonaJobById(job.id)).toMatchObject({
      status: "failed",
      attempts: 2,
      errorCode: "synthesis_invalid",
    });
    expect(getWorkflowRun(run.id)?.status).toBe("failed");
  });

  it("persists a valid synthesis with frozen provenance and is idempotent", async () => {
    const { contact, bundle, job, run } = seedRunningJob();
    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: nanoid(),
      platformHandle: "new-evidence-after-dispatch",
      isActive: 1,
    });

    const completed = await handleCompletePersonaJob({
      jobId: job.id,
      success: true,
      synthesis: validSynthesis,
      model: "claude:claude-fable-5",
    });
    expect(completed).toMatchObject({ accepted: true, status: "completed" });

    const persona = getActivePersona(contact.id);
    expect(persona?.model).toBe("claude:claude-fable-5");
    const sourceWindow = JSON.parse(persona?.sourceWindow ?? "{}") as Record<string, unknown>;
    expect(sourceWindow).toMatchObject({
      generator: "terminal_agent",
      jobId: job.id,
      agentPromptVersion: 1,
      evidenceHash: bundle.provenance.evidenceHash,
    });
    expect(getWorkflowRun(run.id)).toMatchObject({
      status: "completed",
      model: "claude:claude-fable-5",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });

    const duplicate = await handleCompletePersonaJob({
      jobId: job.id,
      success: true,
      synthesis: validSynthesis,
    });
    expect(duplicate).toMatchObject({
      accepted: true,
      idempotent: true,
      personaId: persona?.id,
      status: "completed",
    });
  });

  it("accepts a valid callback after the waiter marked the job timed out", async () => {
    const { contact, job } = seedRunningJob();
    markPersonaJobTimedOut(job.id, "agent timeout");

    const completed = await handleCompletePersonaJob({
      jobId: job.id,
      success: true,
      synthesis: JSON.stringify(validSynthesis),
    });
    expect(completed).toMatchObject({ accepted: true, status: "completed" });
    expect(getPersonaJobById(job.id)?.status).toBe("completed");
    expect(getActivePersona(contact.id)?.id).toBe(getPersonaJobById(job.id)?.resultPersonaId);
  });

  it("returns evidence only while the current hash matches the frozen job hash", async () => {
    const { contact, job } = seedRunningJob();
    expect(await handleGetPersonaJob({ jobId: job.id })).toMatchObject({
      status: "running",
      evidenceDrifted: false,
      evidence: { contact: { name: contact.name } },
    });

    createIdentity({
      contactId: contact.id,
      platform: "linkedin",
      platformUserId: nanoid(),
      platformHandle: "drifted",
      isActive: 1,
    });
    expect(await handleGetPersonaJob({ jobId: job.id })).toMatchObject({
      evidence: null,
      evidenceDrifted: true,
    });
  });
});
