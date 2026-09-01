import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const researchTargetMocks = vi.hoisted(() => ({
  prepareContactWebResearchTarget: vi.fn(),
  releaseContactWebResearchTarget: vi.fn(),
}));

vi.mock("@/lib/workflows/contact-web-research-target", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/workflows/contact-web-research-target")
  >();
  return { ...actual, ...researchTargetMocks };
});

import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import * as workflowTemplates from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun, listWorkflowSteps } from "@/lib/db/queries/workflows";
import { createContact } from "@/lib/db/queries/contacts";
import { getLaunchById, upsertLaunch } from "@/lib/db/queries/launches";
import { buildWritingTemplateConfig } from "@/lib/workflows/signals-writing";
import { buildContactNurtureTemplateConfig } from "@/lib/workflows/contact-relationship-nurture";
import { db } from "@/lib/db/client";
import { workflowRuns } from "@/lib/db/schema";
import { sha256 } from "@/lib/writing/hash";
import { WRITING_SCOPE_TOKEN_CONFIG_KEY } from "@/lib/writing/writing-scope-token";
import { buildContactWebResearchTemplateConfig } from "@/lib/workflows/contact-web-research";
import { resetCoreTables } from "@/test/db";

const preparedResearchTarget = {
  targetId: "target-linkedin",
  platform: "linkedin" as const,
  source: "default" as const,
  sessionName: "signals-publish",
  startUrl: "https://www.linkedin.com/in/current",
  expectedHandle: "/in/current",
  verifiedHandle: "/in/current",
  leaseId: "lease-research",
  leaseExpiresAt: 1_800_000_000,
  preparedAt: 1_799_999_400,
};

describe("runTemplateViaRtx health preflight", () => {
  let storageDir = "";

  beforeEach(() => {
    resetCoreTables();
    storageDir = mkdtempSync(join(tmpdir(), "signals-writing-run-tests-"));
    vi.restoreAllMocks();
    researchTargetMocks.prepareContactWebResearchTarget.mockReset();
    researchTargetMocks.releaseContactWebResearchTarget.mockReset().mockReturnValue({
      leaseId: "lease-research",
      released: true,
      alreadyGone: false,
    });
  });

  afterEach(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("refuses dispatch when Signals health check fails", async () => {
    const template = createTemplate({
      name: "Health Gate",
      templateType: "prospecting",
      status: "active",
      config: "{}",
      isSystem: 1,
    });

    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ status: "error" }),
    })) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        PORT: "3099",
        STORAGE_DIR: storageDir,
      },
      fetchImpl
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe("signals_not_running");
      expect(result.httpStatus).toBe(503);
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3099/api/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("records a successful writing dispatch on its launch", async () => {
    const launch = upsertLaunch({
      name: "Launch",
      metadata: { writing: { sources: [], runs: [], preserve: true, approvalPolicy: "auto" } },
    });
    const template = createTemplate({
      name: "Platform-native writing",
      templateType: "content",
      status: "active",
      config: JSON.stringify(buildWritingTemplateConfig({ launchId: launch.id })),
      isSystem: 1,
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/cli/get-workspace/signals")) {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
      }
      if (url.endsWith("/cli/create-thread/signals")) {
        return new Response(JSON.stringify({ thread: { slug: "writing-thread" } }), {
          status: 200,
        });
      }
      if (url.endsWith("/cli/send-message/signals/writing-thread")) {
        return new Response(
          JSON.stringify({
            success: true,
            terminalDispatchAccepted: true,
            descriptor: { id: "runtime-writing" },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), {
        status: 500,
      });
    }) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      fetchImpl,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const updated = getLaunchById(launch.id)!;
    expect(updated.status).toBe("generating");
    expect(JSON.parse(updated.metadata ?? "{}")).toMatchObject({
      writing: {
        approvalPolicy: "auto",
        preserve: true,
        runs: [
          {
            workflowRunId: result.workflowRunId,
            mode: "draft",
            rtxThreadSlug: "writing-thread",
          },
        ],
      },
    });
  });

  it("persists the writing scope hash before the brief or dispatch leaves the server", async () => {
    // Ordering matters: an accepted dispatch holding a capability whose hash is not yet stored
    // would verify against nothing, permanently if the process died before the post-dispatch write.
    const template = createTemplate({
      name: "Contact Relationship Nurture",
      templateType: "nurture",
      status: "active",
      config: JSON.stringify(buildContactNurtureTemplateConfig()),
      isSystem: 1,
    });

    let hashAtDispatch: unknown;
    let runIdAtDispatch: string | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/cli/get-workspace/signals")) {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
      }
      if (url.endsWith("/cli/create-thread/signals")) {
        return new Response(JSON.stringify({ thread: { slug: "nurture-thread" } }), { status: 200 });
      }
      if (url.endsWith("/cli/send-message/signals/nurture-thread")) {
        // Read the run row at the moment dispatch is being accepted.
        const run = db.select().from(workflowRuns).all().at(-1);
        runIdAtDispatch = run?.id;
        hashAtDispatch = JSON.parse(run?.config ?? "{}")[WRITING_SCOPE_TOKEN_CONFIG_KEY];
        return new Response(
          JSON.stringify({
            success: true,
            terminalDispatchAccepted: true,
            descriptor: { id: "runtime-nurture" },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), { status: 500 });
    }) as unknown as typeof fetch;

    const result = await runTemplateViaRtx(
      { templateId: template.id, signalsBaseUrl: "http://127.0.0.1:3099" },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      fetchImpl,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(runIdAtDispatch).toBe(result.workflowRunId);
    expect(hashAtDispatch).toMatch(/^[a-f0-9]{64}$/);

    const brief = readFileSync(
      join(storageDir, "working-data/signals/workflow-runs", result.workflowRunId, "brief.md"),
      "utf8",
    );
    const token = /writingScopeToken: "([^"]+)"/.exec(brief)?.[1];
    expect(token).toBeDefined();
    // The brief carries the plaintext capability and never the stored hash.
    expect(brief).not.toContain(String(hashAtDispatch));
    expect(brief).not.toContain(WRITING_SCOPE_TOKEN_CONFIG_KEY);
    // The token the agent was handed verifies against what was already persisted.
    expect(sha256(token!)).toBe(hashAtDispatch);
    expect(token!.startsWith(`${result.workflowRunId}.`)).toBe(true);
    // The hash survives the post-dispatch config write.
    expect(JSON.parse(getWorkflowRun(result.workflowRunId)?.config ?? "{}"))
      .toMatchObject({ [WRITING_SCOPE_TOKEN_CONFIG_KEY]: hashAtDispatch });
  });

  function createResearchTemplateAndContact() {
    const contact = createContact({ name: "Sparse Contact", company: "Acme" });
    const template = createTemplate({
      name: "Contact Web Research",
      templateType: "enrichment",
      status: "active",
      config: JSON.stringify(buildContactWebResearchTemplateConfig()),
      isSystem: 1,
    });
    return { contact, template };
  }

  function researchFetch(options: { dispatchAccepted?: boolean } = {}) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ app: "signals", status: "ok" }), { status: 200 });
      }
      if (url.endsWith("/cli/get-workspace/signals")) {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), { status: 200 });
      }
      if (url.endsWith("/cli/create-thread/signals")) {
        expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
          name: "Contact Enrich Profile",
        });
        return new Response(JSON.stringify({ thread: { slug: "contact-enrich-profile" } }), {
          status: 200,
        });
      }
      if (url.endsWith("/cli/send-message/signals/contact-enrich-profile")) {
        if (options.dispatchAccepted === false) {
          return new Response(
            JSON.stringify({
              success: false,
              terminalDispatchAccepted: false,
              code: "TERMINAL_DISPATCH_REQUIRED",
              error: "dispatch rejected",
            }),
            { status: 409 },
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            terminalDispatchAccepted: true,
            descriptor: { id: "runtime-research" },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/sdk/desktop/runtime-sessions/open-launcher")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: `Unexpected request: ${url}` }), {
        status: 500,
      });
    }) as unknown as typeof fetch;
  }

  it("persists the prepared target before dispatch and freezes it into the brief", async () => {
    const { contact, template } = createResearchTemplateAndContact();
    researchTargetMocks.prepareContactWebResearchTarget.mockResolvedValue({
      ok: true,
      target: preparedResearchTarget,
    });

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        config: { contactId: contact.id },
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      researchFetch(),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(JSON.parse(getWorkflowRun(result.workflowRunId)?.config ?? "{}")).toMatchObject({
      researchTarget: preparedResearchTarget,
      rtxRuntimeSessionId: "runtime-research",
      rtxThreadSlug: "contact-enrich-profile",
    });
    const briefPath = join(
      storageDir,
      "working-data/signals/workflow-runs",
      result.workflowRunId,
      "brief.md",
    );
    const brief = readFileSync(briefPath, "utf8");
    expect(brief).toContain("Session name: signals-publish");
    expect(brief).toContain("Start URL: https://www.linkedin.com/in/current");
    expect(brief).toContain("Lease ID: lease-research");
    expect(brief).toContain("Target ID: target-linkedin");
    expect(researchTargetMocks.releaseContactWebResearchTarget).not.toHaveBeenCalled();
  });

  it("fails preflight without writing a brief or dispatching", async () => {
    const { contact, template } = createResearchTemplateAndContact();
    researchTargetMocks.prepareContactWebResearchTarget.mockResolvedValue({
      ok: false,
      error: {
        code: "LOGIN_REQUIRED",
        message: "Open Settings → Platform connections and sign in.",
        details: { targetId: "target-linkedin", platform: "linkedin" },
      },
    });
    const fetchImpl = researchFetch();

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        config: { contactId: contact.id },
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      fetchImpl,
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: "research_target_unavailable",
      httpStatus: 409,
      details: { reason: "LOGIN_REQUIRED" },
    });
    if (result.success || !result.workflowRunId) throw new Error("expected failed run");
    expect(getWorkflowRun(result.workflowRunId)).toMatchObject({ status: "failed", errorItems: 1 });
    expect(listWorkflowSteps(result.workflowRunId)).toEqual([
      expect.objectContaining({ tool: "platform_target_preflight", status: "failed" }),
    ]);
    expect(
      existsSync(
        join(
          storageDir,
          "working-data/signals/workflow-runs",
          result.workflowRunId,
          "brief.md",
        ),
      ),
    ).toBe(false);
    expect(
      vi.mocked(fetchImpl).mock.calls.some(([request]) => String(request).includes("/cli/send-message/")),
    ).toBe(false);
  });

  it("releases the exact lease when dispatch is rejected", async () => {
    const { contact, template } = createResearchTemplateAndContact();
    researchTargetMocks.prepareContactWebResearchTarget.mockResolvedValue({
      ok: true,
      target: preparedResearchTarget,
    });

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        config: { contactId: contact.id },
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      researchFetch({ dispatchAccepted: false }),
    );

    expect(result.success).toBe(false);
    expect(researchTargetMocks.releaseContactWebResearchTarget).toHaveBeenCalledOnce();
    expect(researchTargetMocks.releaseContactWebResearchTarget).toHaveBeenCalledWith(
      "lease-research",
    );
  });

  it("transfers lease ownership after accepted dispatch even if later bookkeeping throws", async () => {
    const { contact, template } = createResearchTemplateAndContact();
    researchTargetMocks.prepareContactWebResearchTarget.mockResolvedValue({
      ok: true,
      target: preparedResearchTarget,
    });
    vi.spyOn(workflowTemplates, "updateTemplate").mockImplementation(() => {
      throw new Error("post-dispatch bookkeeping failed");
    });

    const result = await runTemplateViaRtx(
      {
        templateId: template.id,
        config: { contactId: contact.id },
        signalsBaseUrl: "http://127.0.0.1:3099",
      },
      {
        ...process.env,
        RTX_APP_ID: "test-app-id",
        RTX_API_BASE_URL: "http://127.0.0.1:3001",
        STORAGE_DIR: storageDir,
      },
      researchFetch(),
    );

    expect(result).toMatchObject({ success: false, error: "post-dispatch bookkeeping failed" });
    expect(researchTargetMocks.releaseContactWebResearchTarget).not.toHaveBeenCalled();
  });
});
