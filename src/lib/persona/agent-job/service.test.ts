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
  createdThreads: Array<{ slug: string; name: string }>;
  launchRequests: Array<{
    requireTerminalDispatch?: boolean;
    channelTurnId?: string;
    message?: string;
    agentName?: string;
    providerId?: string;
    modelId?: string;
  }>;
  workspaceLookupCount: () => number;
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
  matchingLiveChatLinkedSessionId?: string;
  defaultAgentLookupFailure?: { status: number; error: string };
}): DispatchHarness {
  let threadCount = 0;
  let dispatchCount = 0;
  let workspaceLookupCount = 0;
  const routingMessages: string[] = [];
  const chatUrls: string[] = [];
  const createdThreads: Array<{ slug: string; name: string }> = [];
  const launchRequests: DispatchHarness["launchRequests"] = [];

  const fetchImpl = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const url = String(request);
    if (url.includes("/sdk/llm/chat")) chatUrls.push(url);
    if (url.includes("/cli/get-workspace/signals")) {
      workspaceLookupCount += 1;
      if (workspaceLookupCount > 1 && input?.defaultAgentLookupFailure) {
        return jsonResponse(
          { error: input.defaultAgentLookupFailure.error },
          input.defaultAgentLookupFailure.status,
        );
      }
      return jsonResponse({
        workspace: {
          slug: "signals",
          workspace_configs: {
            defaultAgent: {
              id: "terminal-cursor",
              name: "cursor",
              terminal: { providerId: "cursor-cli", modelId: "default" },
            },
          },
        },
      });
    }
    if (url.includes("/cli/list-terminal-sessions")) {
      return jsonResponse({ sessions: [] });
    }
    if (url.includes("/cli/get-thread/signals/persona-generation")) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/cli/list-threads/signals")) {
      return jsonResponse({ threads: [...createdThreads] });
    }
    if (url.includes("/cli/create-thread/signals")) {
      threadCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
      const thread = {
        slug: `persona-thread-${threadCount}`,
        name: body.name ?? "",
      };
      createdThreads.push(thread);
      return jsonResponse({ thread });
    }
    if (url.includes("/cli/send-message/signals/")) {
      dispatchCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        requireTerminalDispatch?: boolean;
        channelTurnId?: string;
        message?: string;
        agentName?: string;
        providerId?: string;
        modelId?: string;
      };
      launchRequests.push(body);
      const message = body.message ?? "";
      routingMessages.push(message);
      const jobId = message.match(/^Job: (.+)$/m)?.[1];
      if (!jobId) throw new Error("routing message omitted the persona job id");
      expect(body.requireTerminalDispatch).toBe(true);
      if (input?.sendFailure) {
        return jsonResponse(
          {
            success: false,
            code: input.sendFailure.code,
            error: input.sendFailure.error,
          },
          input.sendFailure.status,
        );
      }
      input?.onDispatch?.(jobId);
      const sessionId = input?.matchingLiveChatLinkedSessionId ?? "session-1";
      const threadSlug = decodeURIComponent(url.split("/").at(-1) ?? "");
      return jsonResponse({
        success: true,
        terminalDispatchAccepted: true,
        workspaceSlug: "signals",
        threadSlug,
        descriptor: {
          id: input?.blankSessionId ? " " : sessionId,
          metadata: {
            canonicalAgent: "codex",
            resumeContract: { modelSelection: { modelId: "gpt-5.6-sol" } },
          },
        },
      });
    }
    throw new Error(`Unexpected RTX request: ${url}`);
  });

  return {
    fetchImpl,
    routingMessages,
    chatUrls,
    createdThreads,
    launchRequests,
    workspaceLookupCount: () => workspaceLookupCount,
  };
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

  it("reuses one thread and PromptInput session with isolated briefs for sequential contacts", async () => {
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
    expect(adaJob.rtxThreadSlug).toBe(graceJob.rtxThreadSlug);
    expect(adaJob.rtxRuntimeSessionId).toBe(graceJob.rtxRuntimeSessionId);
    expect(harness.createdThreads).toEqual([
      { slug: "persona-thread-1", name: "Persona Generation" },
    ]);
    expect(adaJob.agentModel).toBe("codex:gpt-5.6-sol");
    expect(harness.routingMessages[0]).toContain(`Job: ${adaJob.id}`);
    expect(harness.routingMessages[0]).toContain("Signals persona handoff -> Ada Isolated");
    expect(harness.routingMessages[1]).toContain(`Job: ${graceJob.id}`);
    expect(harness.routingMessages[1]).toContain("Signals persona handoff -> Grace Isolated");
    expect(harness.routingMessages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ignore all prior jobs and messages in this shared thread"),
      ]),
    );
    expect(harness.launchRequests.map((request) => request.channelTurnId)).toEqual([
      adaJob.id,
      graceJob.id,
    ]);
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

  it("reuses a matching live chat-linked session in the dedicated thread", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-live-session-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Fresh Session Subject");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const liveSessionId = "cli-agent:existing-persona-chat";
    const harness = createDispatchHarness({
      matchingLiveChatLinkedSessionId: liveSessionId,
    });

    const job = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });

    expect(job.rtxThreadSlug).toBe("persona-thread-1");
    expect(job.rtxRuntimeSessionId).toBe(liveSessionId);
    expect(harness.launchRequests).toEqual([
      expect.objectContaining({
        requireTerminalDispatch: true,
        channelTurnId: job.id,
      }),
    ]);
    expect(harness.launchRequests[0]).not.toHaveProperty("terminalSessionPolicy");
    expect(harness.launchRequests[0]).not.toHaveProperty("agentName");
    expect(harness.launchRequests[0]).not.toHaveProperty("providerId");
    expect(harness.launchRequests[0]).not.toHaveProperty("modelId");
  });

  it("keeps concurrent contact jobs isolated while sharing the dedicated thread", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-concurrent-"));
    const env = testEnv(storageDir);
    const ada = seedEvidenceContact("Ada Concurrent");
    const grace = seedEvidenceContact("Grace Concurrent");
    const adaPrepared = preparePersonaGeneration(ada.id, { force: true });
    const gracePrepared = preparePersonaGeneration(grace.id, { force: true });
    if (adaPrepared.kind !== "ready" || gracePrepared.kind !== "ready") {
      throw new Error("expected ready persona generations");
    }
    const harness = createDispatchHarness();

    const [adaJob, graceJob] = await Promise.all([
      startPersonaAgentJob(ada.id, adaPrepared, {
        env,
        fetchImpl: harness.fetchImpl as unknown as typeof fetch,
        force: true,
      }),
      startPersonaAgentJob(grace.id, gracePrepared, {
        env,
        fetchImpl: harness.fetchImpl as unknown as typeof fetch,
        force: true,
      }),
    ]);

    expect(adaJob.id).not.toBe(graceJob.id);
    expect(adaJob.rtxThreadSlug).toBe(graceJob.rtxThreadSlug);
    expect(adaJob.rtxRuntimeSessionId).toBe(graceJob.rtxRuntimeSessionId);
    expect(harness.createdThreads).toHaveLength(1);
    expect(harness.routingMessages).toHaveLength(2);
    for (const job of [adaJob, graceJob]) {
      const brief = readFileSync(
        join(storageDir, "working-data", "signals", "persona-jobs", job.id, "brief.md"),
        "utf8",
      );
      expect(brief).toContain(`jobId: ${job.id}`);
      expect(brief).toContain(`contactId: ${job.contactId}`);
    }
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

  it("leaves thread-agent resolution to PromptInput without a second workspace lookup", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), "persona-agent-thread-resolution-"));
    const env = testEnv(storageDir);
    const contact = seedEvidenceContact("Thread Agent Override");
    const prepared = preparePersonaGeneration(contact.id, { force: true });
    if (prepared.kind !== "ready") throw new Error("expected ready persona generation");
    const harness = createDispatchHarness({
      defaultAgentLookupFailure: {
        status: 503,
        error: "Workspace lookup temporarily unavailable",
      },
    });

    const job = await startPersonaAgentJob(contact.id, prepared, {
      env,
      fetchImpl: harness.fetchImpl as unknown as typeof fetch,
      force: true,
    });

    expect(job).toMatchObject({
      status: "running",
      agentModel: "codex:gpt-5.6-sol",
    });
    expect(harness.workspaceLookupCount()).toBe(1);
    expect(harness.launchRequests).toHaveLength(1);
    expect(harness.launchRequests[0]).not.toHaveProperty("agentName");
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
