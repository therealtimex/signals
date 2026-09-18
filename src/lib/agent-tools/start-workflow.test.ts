import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedded: true,
  runTemplateViaRtx: vi.fn(),
}));

vi.mock("@/lib/rtx/env", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/rtx/env")>(),
  isRtxEmbedded: () => mocks.embedded,
}));

vi.mock("@/lib/agents/run-template-via-rtx", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/agents/run-template-via-rtx")>(),
  runTemplateViaRtx: mocks.runTemplateViaRtx,
}));

import { handleStartWorkflow } from "@/lib/agent-tools/handlers";
import { createTemplate } from "@/lib/db/queries/workflow-templates";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { resetCoreTables } from "@/test/db";

describe("start_workflow handler", () => {
  beforeEach(() => {
    resetCoreTables();
    mocks.embedded = true;
    mocks.runTemplateViaRtx.mockReset();
  });

  it("forwards only the public RTX launch options", async () => {
    mocks.runTemplateViaRtx.mockResolvedValue({
      success: true,
      workflowRunId: "run-forwarded",
      workspaceSlug: "signals",
      threadSlug: "thread-forwarded",
      threadPath: "Signals/Forwarded",
      threadResolution: { created: true },
      workflowRun: { workflowType: "search" },
    });

    await expect(handleStartWorkflow({
      templateId: "template-snowball",
      workflowType: "search",
      config: { seedValue: "https://example.com/post", maxContacts: 12 },
      systemPrompt: "Use the supplied run constraints.",
      freshThread: true,
      parentWorkflowId: "not-a-launch-option",
      targetContactIds: ["also-not-a-launch-option"],
    })).resolves.toMatchObject({
      runId: "run-forwarded",
      status: "running",
      threadSlug: "thread-forwarded",
    });

    expect(mocks.runTemplateViaRtx).toHaveBeenCalledWith({
      templateId: "template-snowball",
      config: { seedValue: "https://example.com/post", maxContacts: 12 },
      systemPrompt: "Use the supplied run constraints.",
      freshThread: true,
    });
  });

  it("records a config-preserving failed run when embedded launch declines dispatch", async () => {
    const template = createTemplate({
      name: "Declined workflow",
      templateType: "prospecting",
      status: "active",
      config: "{}",
    });
    mocks.runTemplateViaRtx.mockResolvedValue({
      success: false,
      error: "dispatch declined",
      errorCode: "dispatch_declined",
      httpStatus: 409,
    });

    const result = await handleStartWorkflow({
      templateId: template.id,
      workflowType: "search",
      config: { seedValue: "https://example.com/declined", maxContacts: 5 },
    });

    expect(result.status).toBe("failed");
    expect(JSON.parse(getWorkflowRun(result.runId)?.config ?? "{}")).toMatchObject({
      seedValue: "https://example.com/declined",
      maxContacts: 5,
    });
    expect(mocks.runTemplateViaRtx).toHaveBeenCalledOnce();
  });

  it("preserves config in the standalone failed-run fallback", async () => {
    mocks.embedded = false;
    const template = createTemplate({
      name: "Fallback workflow",
      templateType: "prospecting",
      status: "active",
      config: "{}",
    });

    const result = await handleStartWorkflow({
      templateId: template.id,
      workflowType: "search",
      config: { seedValue: "https://example.com/post", maxContacts: 7 },
    });

    expect(result.status).toBe("failed");
    expect(JSON.parse(getWorkflowRun(result.runId)?.config ?? "{}")).toMatchObject({
      seedValue: "https://example.com/post",
      maxContacts: 7,
    });
    expect(mocks.runTemplateViaRtx).not.toHaveBeenCalled();
  });
});
