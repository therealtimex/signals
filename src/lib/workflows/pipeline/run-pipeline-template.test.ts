import { beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { upsertPersona } from "@/lib/db/queries/personas";
import {
  countProfilePipelineBacklog,
  planProfilePipelineRun,
} from "@/lib/db/queries/profile-pipeline-backlog";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createWorkflowRun, getWorkflowRun } from "@/lib/db/queries/workflows";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import { db } from "@/lib/db/client";
import { contentItems, contentPosts, platformAccounts } from "@/lib/db/schema";
import { PIPELINE_STEP_HANDLERS } from "@/lib/workflows/pipeline/handlers";
import {
  executePipelineRun,
  runPipelineTemplate,
} from "@/lib/workflows/pipeline/run-pipeline-template";
import { validatePipelineConfig } from "@/lib/workflows/pipeline/validate-pipeline-config";
import { resetCoreTables } from "@/test/db";

import type { PipelineConfig } from "@/lib/workflows/pipeline/types";

function seedPlatformAccount() {
  const id = nanoid();
  db.insert(platformAccounts)
    .values({ id, platform: "x", displayName: "@brand", authType: "oauth" })
    .run();
  return id;
}

function seedPersonaOnlyBacklogContact(name: string) {
  const contact = createContact({
    name,
    platform: "x",
    platformUserId: nanoid(),
  });
  createIdentity({
    contactId: contact.id,
    platform: "x",
    platformUserId: nanoid(),
    platformHandle: `handle-${nanoid(6)}`,
    isActive: 1,
    avatarUrl: "https://example.com/avatar.jpg",
  });
  const now = Math.floor(Date.now() / 1000);
  const itemId = nanoid();
  db.insert(contentItems)
    .values({
      id: itemId,
      contactId: contact.id,
      contentType: "post",
      title: "Post",
      body: "Public content",
      status: "published",
    })
    .run();
  db.insert(contentPosts)
    .values({
      id: nanoid(),
      contentItemId: itemId,
      platformAccountId: seedPlatformAccount(),
      publishedAt: now,
      status: "published",
    })
    .run();
  return contact;
}

const pipelineConfig: PipelineConfig = {
  version: 2,
  planner: "contact_profile",
  batchSize: 20,
  filters: { needsAvatar: true, needsPersona: true, personaStale: false },
  steps: [
    { id: "hydrate", executor: "code", handler: "hydrate_x_profiles" },
    { id: "avatar", executor: "code", handler: "enrich_contact_avatars" },
    { id: "persona", executor: "llm", handler: "generate_persona" },
  ],
};

function createPipelineTemplate() {
  return createTemplate({
    name: "Contact profile pipeline",
    description: "Test pipeline",
    templateType: "enrichment",
    status: "active",
    config: JSON.stringify({ pipeline: pipelineConfig }),
    systemPrompt: "",
  });
}

describe("validatePipelineConfig", () => {
  it("rejects agent executor steps", () => {
    const result = validatePipelineConfig({
      ...pipelineConfig,
      steps: [{ id: "discover", executor: "agent", handler: "enrich_contact_avatars" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("PIPELINE_STEP_UNSUPPORTED");
    }
  });
});

describe("runPipelineTemplate", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    vi.restoreAllMocks();
  });

  it("returns 201-shaped success with plan and stores RTX refs", async () => {
    vi.spyOn(await import("@/lib/rtx/env"), "isRtxEmbedded").mockReturnValue(true);
    vi.spyOn(await import("@/lib/rtx/cli-provisioning"), "ensureRtxWorkspace").mockResolvedValue(
      "signals",
    );
    vi.spyOn(await import("@/lib/rtx/cli-provisioning"), "createRtxPublishThread").mockResolvedValue(
      "pipeline-thread",
    );

    const template = createPipelineTemplate();
    const contact = createContact({ name: "Pipeline Subject", platform: "x", platformUserId: "u1" });

    const result = await runPipelineTemplate({
      templateId: template.id,
      input: { contactIds: [contact.id] },
      env: { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.plan.explicit).toBe(true);
    expect(result.threadPath).toBe("/workspace/signals/t/pipeline-thread");

    const refs = getRtxRefsFromRunConfig(result.workflowRun.config);
    expect(refs).toEqual({
      workspaceSlug: "signals",
      threadSlug: "pipeline-thread",
    });

    await executePipelineRun({
      workflowRunId: result.workflowRunId,
      templateId: template.id,
      pipeline: pipelineConfig,
      plan: result.plan,
      forcePersona: false,
      scheduleDrain: false,
      trigger: "template",
      workspaceSlug: "signals",
      threadSlug: "pipeline-thread",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch,
      env: { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
    });

    const completed = getWorkflowRun(result.workflowRunId);
    expect(completed?.status).toBe("completed");
    expect(completed?.steps.some((s) => s.tool === "profile_pipeline_summary")).toBe(true);
  });

  it("uses run input batchSize override instead of template default", async () => {
    for (let i = 0; i < 6; i += 1) {
      seedPersonaOnlyBacklogContact(`Backlog ${i}`);
    }

    const template = createPipelineTemplate();
    const result = await runPipelineTemplate({
      templateId: template.id,
      input: { batchSize: 5 },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan.batchSize).toBe(5);
    expect(result.plan.selectedContactIds).toHaveLength(5);
  });

  it("refuses concurrent non-explicit runs with PIPELINE_RUN_ACTIVE", async () => {
    const template = createPipelineTemplate();

    const first = await runPipelineTemplate({ templateId: template.id });
    expect(first.success).toBe(true);

    const second = await runPipelineTemplate({ templateId: template.id });
    expect(second).toEqual({
      success: false,
      error: "A pipeline run is already active for this template",
      errorCode: "PIPELINE_RUN_ACTIVE",
      httpStatus: 409,
    });
  });

  it("allows explicit runs while a background run is active", async () => {
    const template = createPipelineTemplate();
    const contact = createContact({ name: "Explicit Run", platform: "x", platformUserId: "u2" });

    const background = await runPipelineTemplate({ templateId: template.id });
    expect(background.success).toBe(true);

    const explicit = await runPipelineTemplate({
      templateId: template.id,
      input: { contactIds: [contact.id] },
    });
    expect(explicit.success).toBe(true);
  });

  it("sends exactly 3+N aggregate thread messages", async () => {
    const messages: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/send-message/")) {
        const body = JSON.parse(String(init?.body)) as { message?: string };
        if (body.message) messages.push(body.message);
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    const template = createPipelineTemplate();
    const contact = createContact({ name: "Secret Name", email: "secret@example.com" });

    const started = await runPipelineTemplate({
      templateId: template.id,
      input: { contactIds: [contact.id] },
      env: { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(started.success).toBe(true);
    if (!started.success) return;

    await executePipelineRun({
      workflowRunId: started.workflowRunId,
      templateId: template.id,
      pipeline: pipelineConfig,
      plan: started.plan,
      forcePersona: false,
      scheduleDrain: false,
      trigger: "template",
      workspaceSlug: "signals",
      threadSlug: "thread-1",
      fetchImpl: fetchImpl as typeof fetch,
      env: { RTX_APP_ID: "app-1", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
    });

    expect(messages).toHaveLength(2 + pipelineConfig.steps.length);
    const combined = messages.join("\n");
    expect(combined).not.toContain("Secret Name");
    expect(combined).not.toContain("secret@example.com");
    expect(combined).toContain("Contact profile pipeline");
    expect(combined).toContain("Connect X to enable profile hydration");
    expect(combined).toContain(started.workflowRunId);
  });

  it("keeps hydration updates separate from avatar and persona totals", async () => {
    const contact = createContact({ name: "X user 123" });
    createIdentity({
      contactId: contact.id,
      platform: "x",
      platformUserId: "123",
      avatarUrl: "https://example.com/avatar.jpg",
      isActive: 1,
    });
    const plan = planProfilePipelineRun({ contactIds: [contact.id] });

    vi.spyOn(PIPELINE_STEP_HANDLERS, "hydrate_x_profiles").mockImplementation(
      async (ids, stepCtx) => ({
        stepId: stepCtx.stepId,
        outcomes: ids.map((contactId) => ({ contactId, status: "updated" as const })),
        aborted: false,
      }),
    );
    vi.spyOn(PIPELINE_STEP_HANDLERS, "enrich_contact_avatars").mockImplementation(
      async (ids, stepCtx) => ({
        stepId: stepCtx.stepId,
        outcomes: ids.map((contactId) => ({
          contactId,
          status: "skipped" as const,
          reason: "avatar_present",
        })),
        aborted: false,
      }),
    );
    vi.spyOn(PIPELINE_STEP_HANDLERS, "generate_persona").mockImplementation(
      async (ids, stepCtx) => {
        for (const contactId of ids) {
          upsertPersona({
            contactId,
            archetype: "Builder",
            tone: "Direct",
            summary: "Generated",
            scope: "shared",
          });
        }
        return {
          stepId: stepCtx.stepId,
          outcomes: ids.map((contactId) => ({ contactId, status: "generated" as const })),
          aborted: false,
        };
      },
    );

    const template = createPipelineTemplate();
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      config: "{}",
      startedAt: Math.floor(Date.now() / 1000),
      totalItems: 1,
    });

    await executePipelineRun({
      workflowRunId: run.id,
      templateId: template.id,
      pipeline: pipelineConfig,
      plan,
      forcePersona: false,
      scheduleDrain: false,
      trigger: "template",
      workspaceSlug: null,
      threadSlug: null,
      fetchImpl: fetch,
      env: process.env,
    });

    const result = JSON.parse(getWorkflowRun(run.id)?.result ?? "{}") as Record<string, unknown>;
    expect(result).toMatchObject({
      profilesHydrated: 1,
      avatarsUpdated: 0,
      personasGenerated: 1,
      hydrationOutcomes: { updated: 1, notFound: 0 },
      avatarOutcomes: { updated: 0, gravatarVerified: 0 },
    });
  });

  it("remainingBacklog re-queries and counts contacts entering backlog mid-run", async () => {
    seedPersonaOnlyBacklogContact("Original A");
    seedPersonaOnlyBacklogContact("Original B");

    const plan = planProfilePipelineRun({ batchSize: 1 });
    expect(plan.backlogTotal).toBe(2);
    expect(plan.selectedContactIds).toHaveLength(1);

    vi.spyOn(PIPELINE_STEP_HANDLERS, "enrich_contact_avatars").mockImplementation(
      async (ids, ctx) => ({
        stepId: ctx.stepId,
        outcomes: ids.map((contactId) => ({
          contactId,
          status: "skipped" as const,
          reason: "avatar_present",
        })),
        aborted: false,
      }),
    );

    vi.spyOn(PIPELINE_STEP_HANDLERS, "generate_persona").mockImplementation(
      async (ids, ctx) => {
        seedPersonaOnlyBacklogContact("Mid-run newcomer");
        for (const contactId of ids) {
          upsertPersona({
            contactId,
            archetype: "Founder",
            tone: "Direct",
            summary: "Generated in test",
            scope: "shared",
          });
        }
        return {
          stepId: ctx.stepId,
          outcomes: ids.map((contactId) => ({
            contactId,
            status: "generated" as const,
            detail: { personaWorkflowRunId: "child-mid-run" },
          })),
          aborted: false,
        };
      },
    );

    const template = createPipelineTemplate();
    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: "enrich",
      status: "running",
      trigger: "template",
      config: JSON.stringify({ backlogTotal: plan.backlogTotal }),
      startedAt: Math.floor(Date.now() / 1000),
      totalItems: plan.selectedContactIds.length,
    });

    await executePipelineRun({
      workflowRunId: run.id,
      templateId: template.id,
      pipeline: pipelineConfig,
      plan,
      forcePersona: false,
      scheduleDrain: false,
      trigger: "template",
      workspaceSlug: null,
      threadSlug: null,
      fetchImpl: fetch,
      env: process.env,
    });

    const completed = getWorkflowRun(run.id);
    const result = JSON.parse(completed?.result ?? "{}") as { remainingBacklog?: number };

    expect(result.remainingBacklog).toBe(2);
    expect(result.remainingBacklog).toBe(countProfilePipelineBacklog());
    expect(result.remainingBacklog).not.toBe(plan.backlogTotal - plan.selectedContactIds.length);
  });
});
