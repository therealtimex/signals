import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { handleCompletePersonaJob } from "@/lib/agent-tools/persona-job-handlers";
import { db } from "@/lib/db/client";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { logInteraction } from "@/lib/db/queries/interactions";
import {
  claimPersonaJobCompletion,
  getLatestPersonaJobForContact,
  getPersonaJobById,
  markPersonaJobTimedOut,
  PERSONA_JOB_COMPLETION_LEASE_MS,
} from "@/lib/db/queries/persona-jobs";
import { upsertPersona } from "@/lib/db/queries/personas";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { personaJobs } from "@/lib/db/schema";
import { preparePersonaGeneration } from "@/lib/persona/generation/prepare";
import { awaitPersonaJob, startPersonaAgentJob } from "@/lib/persona/agent-job/service";
import { generatePersona } from "@/lib/workflows/generate-persona";
import { resetCoreTables } from "@/test/db";
import { assertNoPrivacySentinels, PRIVACY_SENTINELS } from "@/test/privacy-sentinels";

const validSynthesis = {
  archetype: "Technical Founder",
  tone: "Concise",
  summary: "Shares practical product and engineering lessons",
  interests: ["developer tools"],
  conversionTriggers: ["credible benchmarks"],
  engagementFormats: ["technical threads"],
  confidence: 0.74,
};

const originalRtxAppId = process.env.RTX_APP_ID;

type DispatchHarness = {
  fetchImpl: ReturnType<typeof vi.fn>;
  routingMessages: string[];
  chatUrls: string[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createDispatchHarness(input?: {
  sendFailure?: { status: number; code: string; error: string };
  onDispatch?: (jobId: string) => void;
  blankSessionId?: boolean;
}): DispatchHarness {
  let threadCount = 0;
  const routingMessages: string[] = [];
  const chatUrls: string[] = [];

  const fetchImpl = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const url = String(request);
    if (url.includes("/sdk/llm/chat")) chatUrls.push(url);
    if (url.includes("/cli/get-workspace/signals")) {
      return jsonResponse({ workspace: { slug: "signals" } });
    }
    if (url.includes("/cli/list-terminal-sessions")) {
      return jsonResponse({ sessions: [] });
    }
    if (url.includes("/cli/terminate-terminal-session/")) {
      return jsonResponse({ success: true });
    }
    if (url.includes("/cli/create-thread/signals")) {
      threadCount += 1;
      return jsonResponse({ thread: { slug: `persona-thread-${threadCount}` } });
    }
    if (url.includes("/cli/send-message/signals/")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
      const message = body.message ?? "";
      routingMessages.push(message);
      const jobId = message.match(/^Job: (.+)$/m)?.[1];
      if (!jobId) throw new Error("routing message omitted the persona job id");
      if (input?.sendFailure) {
        return jsonResponse(
          { code: input.sendFailure.code, error: input.sendFailure.error },
          input.sendFailure.status,
        );
      }
      input?.onDispatch?.(jobId);
      return jsonResponse({
        success: true,
        terminalDispatchAccepted: true,
        workspaceSlug: "signals",
        threadSlug: `persona-thread-${threadCount}`,
        descriptor: {
          id: input?.blankSessionId ? " " : `session-${threadCount}`,
          metadata: { canonicalAgent: "codex" },
          resumeContract: { modelSelection: { modelId: "gpt-5.6-sol" } },
        },
      });
    }
    throw new Error(`Unexpected RTX request: ${url}`);
  });

  return { fetchImpl, routingMessages, chatUrls };
}

describe("PersonaAgentJob service", () => {
  beforeEach(() => {
    resetCoreTables();
    delete process.env.RTX_APP_ID;
  });

  afterEach(() => {
    if (originalRtxAppId === undefined) delete process.env.RTX_APP_ID;
    else process.env.RTX_APP_ID = originalRtxAppId;
  });

  function seedEvidenceContact(name: string) {
    const contact = createContact({ name });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: nanoid(),
      platformHandle: name.toLowerCase().replaceAll(" ", "-"),
      isActive: 1,
    });
    logInteraction({
      contactId: contact.id,
      interactionType: "note",
      summary: PRIVACY_SENTINELS.interactionSummary,
      scope: "local_only",
      source: "test",
    });
    return contact;
  }

  function testEnv(storageDir: string) {
    return {
      RTX_APP_ID: "signals-app",
      SERVER_URL: "http://127.0.0.1:3101",
      STORAGE_DIR: storageDir,
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };
  }

  it("joins a fresh active job and supersedes it only after the stale boundary", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-service-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Join Subject");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness();

    const first = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    const joined = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(joined.id).toBe(first.id);
    expect(harness.routingMessages).toHaveLength(1);

    db.update(personaJobs)
      .set({ updatedAt: Math.floor(Date.now() / 1000) - 31 * 60 })
      .where(eq(personaJobs.id, first.id))
      .run();
    const replacement = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(replacement.id).not.toBe(first.id);
    expect(harness.routingMessages).toHaveLength(2);
    expect(db.select().from(personaJobs).where(eq(personaJobs.id, first.id)).get()?.status).toBe(
      "superseded",
    );
  });

  it("supersedes a timed-out predecessor before dispatching its retry", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-retry-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Retry Subject");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness();

    const first = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(markPersonaJobTimedOut(first.id, "agent timeout")?.status).toBe("timeout");

    const retry = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });

    expect(retry.id).not.toBe(first.id);
    expect(getPersonaJobById(first.id)).toMatchObject({
      status: "superseded",
      errorCode: "superseded",
    });
    expect(harness.routingMessages).toHaveLength(2);
  });

  it("fails an abandoned completion lease and allows a new generation", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-abandoned-completion-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Abandoned Completion Subject");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness();

    const first = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(claimPersonaJobCompletion(first.id)).toMatchObject({
      claimed: true,
      job: { status: "completing" },
    });
    db.update(personaJobs)
      .set({
        updatedAt: Math.floor((Date.now() - PERSONA_JOB_COMPLETION_LEASE_MS - 1_000) / 1_000),
      })
      .where(eq(personaJobs.id, first.id))
      .run();
    expect(getPersonaJobById(first.id)).toMatchObject({ status: "completing", stale: true });

    const abandoned = await awaitPersonaJob(first.id, { timeoutMs: 0, pollMs: 0 });
    expect(abandoned).toMatchObject({
      status: "failed",
      errorCode: "completion_abandoned",
      stale: false,
    });
    expect(getWorkflowRun(first.workflowRunId)?.status).toBe("failed");

    const retry = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(retry).toMatchObject({ status: "running" });
    expect(retry.id).not.toBe(first.id);
    expect(harness.routingMessages).toHaveLength(2);
  });

  it("recovers a persisted persona from an abandoned completion lease", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-recovered-completion-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Recovered Completion Subject");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness();

    const job = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    expect(claimPersonaJobCompletion(job.id).claimed).toBe(true);
    const persona = upsertPersona({
      contactId: contact.id,
      archetype: validSynthesis.archetype,
      tone: validSynthesis.tone,
      summary: validSynthesis.summary,
      interests: validSynthesis.interests,
      conversionTriggers: validSynthesis.conversionTriggers,
      engagementFormats: validSynthesis.engagementFormats,
      confidence: validSynthesis.confidence,
      model: "codex:gpt-5.6-sol",
      workflowRunId: job.workflowRunId,
      sourceWindow: { jobId: job.id },
    });
    db.update(personaJobs)
      .set({
        updatedAt: Math.floor((Date.now() - PERSONA_JOB_COMPLETION_LEASE_MS - 1_000) / 1_000),
      })
      .where(eq(personaJobs.id, job.id))
      .run();

    const recovered = await awaitPersonaJob(job.id, { timeoutMs: 0, pollMs: 0 });
    expect(recovered).toMatchObject({
      status: "completed",
      resultPersonaId: persona.id,
      stale: false,
    });
    expect(getWorkflowRun(job.workflowRunId)).toMatchObject({
      status: "completed",
      model: "codex:gpt-5.6-sol",
    });
  });

  it("uses distinct jobs, fresh threads, and isolated brief content for sequential contacts", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-isolation-"));
    const env = testEnv(storageDir);
    const ada = seedEvidenceContact("Ada Isolated");
    const grace = seedEvidenceContact("Grace Isolated");
    const adaPrepared = preparePersonaGeneration(ada.id, { force: true });
    const gracePrepared = preparePersonaGeneration(grace.id, { force: true });
    if (adaPrepared.kind !== "ready" || gracePrepared.kind !== "ready") {
      throw new Error("expected ready persona generations");
    }
    const harness = createDispatchHarness();

    const adaJob = await startPersonaAgentJob(ada.id, adaPrepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });
    const graceJob = await startPersonaAgentJob(grace.id, gracePrepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });

    expect(adaJob.id).not.toBe(graceJob.id);
    expect(adaJob.rtxThreadSlug).not.toBe(graceJob.rtxThreadSlug);
    expect(adaJob.agentModel).toBe("codex:gpt-5.6-sol");
    const adaBrief = readFileSync(
      join(storageDir, "working-data", "signals", "persona-jobs", adaJob.id, "brief.md"),
      "utf8",
    );
    const graceBrief = readFileSync(
      join(storageDir, "working-data", "signals", "persona-jobs", graceJob.id, "brief.md"),
      "utf8",
    );
    expect(adaBrief).toContain("Ada Isolated");
    expect(adaBrief).not.toContain("Grace Isolated");
    expect(graceBrief).toContain("Grace Isolated");
    expect(graceBrief).not.toContain("Ada Isolated");
    assertNoPrivacySentinels(adaBrief);
    assertNoPrivacySentinels(graceBrief);
  });

  it("records an actionable failed job and run when terminal dispatch is unavailable", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-failure-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("No Default Agent");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness({
      sendFailure: {
        status: 409,
        code: "TERMINAL_DISPATCH_REQUIRED",
        error: "No default agent",
      },
    });

    await expect(
      startPersonaAgentJob(contact.id, prepared, {
        env,
        fetchImpl: harness.fetchImpl as unknown as typeof fetch,
        force: true,
      }),
    ).rejects.toMatchObject({
      rtxCode: "TERMINAL_DISPATCH_REQUIRED",
    });
    const failed = getLatestPersonaJobForContact(contact.id);
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "terminal_dispatch_required",
    });
    expect(failed?.error).toContain("workspace settings");
    expect(getWorkflowRun(failed!.workflowRunId)?.status).toBe("failed");
  });

  it("routes the blocking facade through dispatch and a simulated callback without llm.chat", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-blocking-"));
    const contact = seedEvidenceContact("Blocking Callback");
    const harness = createDispatchHarness({
      blankSessionId: true,
      onDispatch(jobId) {
        setTimeout(() => {
          void handleCompletePersonaJob({
            jobId,
            success: true,
            synthesis: validSynthesis,
            model: "codex:gpt-5.6-sol",
          });
        }, 0);
      },
    });

    const result = await generatePersona(contact.id, {
      force: true,
      env: {
        ...testEnv(storageDir),
        SIGNALS_PERSONA_GENERATION_MODE: "terminal_agent",
        PERSONA_AGENT_JOB_TIMEOUT_MS: "5000",
      },
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      generated: true,
      persona: { archetype: validSynthesis.archetype },
    });
    expect(harness.routingMessages).toHaveLength(1);
    expect(harness.chatUrls).toHaveLength(0);
  });
});
