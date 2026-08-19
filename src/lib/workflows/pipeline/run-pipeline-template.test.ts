import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContact } from "@/lib/db/queries/contacts";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import {
  executePipelineRun,
  runPipelineTemplate,
} from "@/lib/workflows/pipeline/run-pipeline-template";
import { validatePipelineConfig } from "@/lib/workflows/pipeline/validate-pipeline-config";
import { resetCoreTables } from "@/test/db";

import type { PipelineConfig } from "@/lib/workflows/pipeline/types";

const pipelineConfig: PipelineConfig = {
  version: 1,
  planner: "contact_profile",
  batchSize: 20,
  filters: { needsAvatar: true, needsPersona: true, personaStale: false },
  steps: [
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
    expect(combined).toContain(started.workflowRunId);
  });
});
