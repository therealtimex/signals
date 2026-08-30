import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoreTables } from "@/test/db";
import {
  createWorkflowRun,
  getWorkflowRun,
  listWorkflowSteps,
} from "@/lib/db/queries/workflows";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { createContact } from "@/lib/db/queries/contacts";
import { createIdentity } from "@/lib/db/queries/identities";
import { buildWorkflowCascadeConfig } from "@/lib/workflows/chaining";
import {
  emitWorkflowCompletedEvent,
  evaluateAgenticRouting,
} from "@/lib/webhooks/workflow-events";
import { PIPELINE_STEP_HANDLERS } from "@/lib/workflows/pipeline/handlers";

describe("Workflow Events & Agentic Router", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.restoreAllMocks();
  });

  it("evaluates agentic routing for investor heavy cohort", () => {
    const c1 = createContact({ name: "Alice VC" });
    const c2 = createContact({ name: "Bob Angel" });
    const c3 = createContact({ name: "Charlie Dev" });

    createIdentity({
      contactId: c1.id,
      platform: "x",
      platformUserId: "alice_vc",
      headline: "General Partner at Horizon Fund",
      avatarUrl: "https://cdn.example/alice.jpg",
    });
    createIdentity({
      contactId: c2.id,
      platform: "x",
      platformUserId: "bob_angel",
      headline: "Angel Investor",
      avatarUrl: "https://cdn.example/bob.jpg",
    });
    createIdentity({
      contactId: c3.id,
      platform: "x",
      platformUserId: "charlie_dev",
      headline: "Software Engineer",
      avatarUrl: "https://cdn.example/charlie.jpg",
    });

    const evaluation = evaluateAgenticRouting([c1.id, c2.id, c3.id]);
    expect(evaluation.suggestedAction).toBe("nurture");
    expect(evaluation.rationale).toContain("high-value investor node");
  });

  it("evaluates agentic routing for unhydrated cohort", () => {
    const c1 = createContact({ name: "Founder 1" });
    const c2 = createContact({ name: "Founder 2" });

    const evaluation = evaluateAgenticRouting([c1.id, c2.id]);
    expect(evaluation.suggestedAction).toBe("profile_pipeline");
    expect(evaluation.rationale).toContain("Contact Profile Pipeline");
  });

  it("emits event and executes deterministic cascade", async () => {
    const nurtureTemplate = createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: nurtureTemplate.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["contact_nurture"],
          cascadePolicy: "immediate",
        }),
      }),
    });

    const c1 = createContact({ name: "Alice" });
    const result = await emitWorkflowCompletedEvent(parentRun.id, {
      summary: "Snowball mapped 1 node",
      createdContactIds: [c1.id],
    });

    expect(result.emitted).toBe(true);
    expect(result.event.event).toBe("workflow.completed");
    expect(result.cascadeResult?.triggered).toBe(true);
    expect(result.cascadeResult?.childRunIds).toHaveLength(1);
    expect(result.cascadeResult?.targetTemplateNames).toContain("Contact Relationship Nurture");
  });

  it("auto-chains the profile pipeline when contact web research links an identity", async () => {
    vi.spyOn(await import("@/lib/rtx/env"), "isRtxEmbedded").mockReturnValue(true);
    vi.spyOn(await import("@/lib/rtx/cli-provisioning"), "ensureRtxWorkspace").mockResolvedValue(
      "signals",
    );
    vi.spyOn(
      await import("@/lib/rtx/cli-provisioning"),
      "createRtxPublishThread",
    ).mockResolvedValue("pipeline-thread");
    vi.spyOn(
      await import("@/lib/rtx/runtime-sessions"),
      "appendRtxThreadMessage",
    ).mockResolvedValue({ success: true });
    const terminalAgentRunner = vi
      .spyOn(await import("@/lib/agents/run-template-via-rtx"), "runTemplateViaRtx")
      .mockResolvedValue({
        success: false,
        error: "Pipeline templates must not use the terminal-agent runner",
        errorCode: "wrong_runner",
        httpStatus: 500,
      });
    vi.spyOn(PIPELINE_STEP_HANDLERS, "enrich_contact_avatars").mockImplementation(
      async (contactIds) => ({
        stepId: "avatar",
        outcomes: contactIds.map((contactId) => ({
          contactId,
          status: "skipped" as const,
          reason: "not_found",
        })),
        aborted: false,
      }),
    );

    createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
      config: JSON.stringify({
        pipeline: {
          version: 2,
          planner: "contact_profile",
          batchSize: 20,
          steps: [
            {
              id: "avatar",
              executor: "code",
              handler: "enrich_contact_avatars",
            },
          ],
        },
      }),
    });
    const webTemplate = createTemplate({
      name: "Contact Web Research",
      templateType: "enrichment",
      status: "active",
    });
    const contact = createContact({ name: "Researched Contact" });
    const parentRun = createWorkflowRun({
      templateId: webTemplate.id,
      workflowType: "enrich",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({ contactWebResearch: { version: 1 }, contactId: contact.id }),
      result: JSON.stringify({ identityLinked: true }),
    });

    const result = await emitWorkflowCompletedEvent(parentRun.id);

    expect(result.cascadeResult).toMatchObject({
      triggered: true,
      followOnAction: "profile_pipeline",
      targetTemplateName: "Contact profile pipeline",
    });
    const child = getWorkflowRun(result.cascadeResult!.childRunId!)!;
    expect(child.parentWorkflowId).toBe(parentRun.id);
    expect(JSON.parse(child.config ?? "{}")).toMatchObject({
      targetContactIds: [contact.id],
      selectedContactIds: [contact.id],
    });
    expect(listWorkflowSteps(child.id).some((step) => step.tool === "profile_pipeline_planner"))
      .toBe(true);
    await vi.waitFor(() => {
      expect(
        listWorkflowSteps(child.id).some((step) => step.tool === "profile_pipeline_summary"),
      ).toBe(true);
    });
    expect(terminalAgentRunner).not.toHaveBeenCalled();
  });

  it("does not auto-chain when web research leaves identity unresolved", async () => {
    createTemplate({
      name: "Contact profile pipeline",
      templateType: "enrichment",
      status: "active",
    });
    const webTemplate = createTemplate({
      name: "Contact Web Research",
      templateType: "enrichment",
      status: "active",
    });
    const contact = createContact({ name: "Ambiguous Contact" });
    const parentRun = createWorkflowRun({
      templateId: webTemplate.id,
      workflowType: "enrich",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({ contactWebResearch: { version: 1 }, contactId: contact.id }),
      result: JSON.stringify({ identityLinked: false, ambiguous: true, partial: true }),
    });

    const result = await emitWorkflowCompletedEvent(parentRun.id);

    expect(result.cascadeResult).toBeUndefined();
  });

  it("emits event with agentic router recommendation", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
      config: JSON.stringify({
        cascadeConfig: buildWorkflowCascadeConfig({
          followOnActions: ["agentic_router"],
        }),
      }),
    });

    const c1 = createContact({ name: "Sarah GP" });
    createIdentity({
      contactId: c1.id,
      platform: "linkedin",
      platformUserId: "sarah_gp",
      headline: "General Partner at Venture Fund",
      avatarUrl: "https://cdn.example/sarah.jpg",
    });

    const result = await emitWorkflowCompletedEvent(parentRun.id, {
      createdContactIds: [c1.id],
    });

    expect(result.emitted).toBe(true);
    expect(result.routingRecommendation?.suggestedAction).toBe("nurture");
    expect(result.cascadeResult?.followOnAction).toBe("agentic_router");
  });

  it("dispatches outbound HTTP POST to configured webhook destination", async () => {
    const template = createTemplate({
      name: "Network Snowball",
      templateType: "prospecting",
      status: "active",
    });

    const parentRun = createWorkflowRun({
      templateId: template.id,
      workflowType: "search",
      status: "completed",
      trigger: "template",
    });

    let sentUrl = "";
    let sentBody = "";
    const mockFetch = (async (url: string, init?: RequestInit) => {
      sentUrl = url;
      sentBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await emitWorkflowCompletedEvent(parentRun.id, {
      webhookUrl: "https://realtimex.ai/api/webhooks/orchestrator",
      fetchImpl: mockFetch,
    });

    expect(result.emitted).toBe(true);
    expect(sentUrl).toBe("https://realtimex.ai/api/webhooks/orchestrator");
    expect(sentBody).toContain('"event":"workflow.completed"');
  });

  it("omits outbound webhook signatures when no secret is configured", async () => {
    const prevSignals = process.env.SIGNALS_WEBHOOK_SECRET;
    const prevRtx = process.env.REALTIMEX_WEBHOOK_SECRET;
    delete process.env.SIGNALS_WEBHOOK_SECRET;
    delete process.env.REALTIMEX_WEBHOOK_SECRET;

    try {
      const template = createTemplate({
        name: "Network Snowball",
        templateType: "prospecting",
        status: "active",
      });

      const parentRun = createWorkflowRun({
        templateId: template.id,
        workflowType: "search",
        status: "completed",
        trigger: "template",
      });

      let sentHeaders: Record<string, string> | undefined;
      const mockFetch = (async (_url: string, init?: RequestInit) => {
        sentHeaders = init?.headers as Record<string, string> | undefined;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      await emitWorkflowCompletedEvent(parentRun.id, {
        webhookUrl: "https://example.com/hook",
        fetchImpl: mockFetch,
      });

      expect(sentHeaders?.["X-Webhook-Signature-256"]).toBeUndefined();
      expect(sentHeaders?.["x-realtimex-signature"]).toBeUndefined();
    } finally {
      if (prevSignals === undefined) {
        delete process.env.SIGNALS_WEBHOOK_SECRET;
      } else {
        process.env.SIGNALS_WEBHOOK_SECRET = prevSignals;
      }
      if (prevRtx === undefined) {
        delete process.env.REALTIMEX_WEBHOOK_SECRET;
      } else {
        process.env.REALTIMEX_WEBHOOK_SECRET = prevRtx;
      }
    }
  });

  it("signs outbound webhook when SIGNALS_WEBHOOK_SECRET is set", async () => {
    const prevSignals = process.env.SIGNALS_WEBHOOK_SECRET;
    process.env.SIGNALS_WEBHOOK_SECRET = "test-secret-key-12345";

    try {
      const template = createTemplate({
        name: "Network Snowball",
        templateType: "prospecting",
        status: "active",
      });

      const parentRun = createWorkflowRun({
        templateId: template.id,
        workflowType: "search",
        status: "completed",
        trigger: "template",
      });

      let sentHeaders: Record<string, string> | undefined;
      const mockFetch = (async (_url: string, init?: RequestInit) => {
        sentHeaders = init?.headers as Record<string, string> | undefined;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      await emitWorkflowCompletedEvent(parentRun.id, {
        webhookUrl: "https://example.com/hook",
        fetchImpl: mockFetch,
      });

      expect(sentHeaders?.["X-Webhook-Signature-256"]).toMatch(/^sha256=/);
      expect(sentHeaders?.["x-realtimex-signature"]).toMatch(/^sha256=/);
    } finally {
      if (prevSignals === undefined) {
        delete process.env.SIGNALS_WEBHOOK_SECRET;
      } else {
        process.env.SIGNALS_WEBHOOK_SECRET = prevSignals;
      }
    }
  });

  it("resolves agentic router webhook URL from REALTIMEX_BASE_URL", async () => {
    const previousBaseUrl = process.env.REALTIMEX_BASE_URL;
    const previousApiBaseUrl = process.env.RTX_API_BASE_URL;
    const previousServerUrl = process.env.SERVER_URL;
    process.env.REALTIMEX_BASE_URL = "http://127.0.0.1:3101/cli";
    delete process.env.RTX_API_BASE_URL;
    delete process.env.SERVER_URL;

    try {
      const template = createTemplate({
        name: "Network Snowball",
        templateType: "prospecting",
        status: "active",
      });

      const parentRun = createWorkflowRun({
        templateId: template.id,
        workflowType: "search",
        status: "completed",
        trigger: "template",
        config: JSON.stringify({
          cascadeConfig: buildWorkflowCascadeConfig({
            followOnActions: ["agentic_router"],
          }),
        }),
      });

      let sentUrl = "";
      const mockFetch = (async (url: string) => {
        sentUrl = url;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      await emitWorkflowCompletedEvent(parentRun.id, {
        fetchImpl: mockFetch,
      });

      expect(sentUrl).toBe(
        "http://127.0.0.1:3101/api/v1/webhook-ingress/inbound/signals-orchestrator"
      );
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.REALTIMEX_BASE_URL;
      } else {
        process.env.REALTIMEX_BASE_URL = previousBaseUrl;
      }
      if (previousApiBaseUrl === undefined) {
        delete process.env.RTX_API_BASE_URL;
      } else {
        process.env.RTX_API_BASE_URL = previousApiBaseUrl;
      }
      if (previousServerUrl === undefined) {
        delete process.env.SERVER_URL;
      } else {
        process.env.SERVER_URL = previousServerUrl;
      }
    }
  });
});
