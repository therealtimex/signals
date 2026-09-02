import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentToolError } from "@/lib/agent-tools/types";

const mocks = vi.hoisted(() => ({
  materialize: vi.fn(),
  reject: vi.fn(),
  revision: vi.fn(),
  refreshed: vi.fn(),
  refs: vi.fn(),
}));

vi.mock("@/lib/writing/materialize", () => ({
  materializeVariant: mocks.materialize,
}));
vi.mock("@/lib/writing/variant-writing", () => ({
  rejectWritingProposal: mocks.reject,
  requestWritingProposalRevision: mocks.revision,
}));
vi.mock("@/lib/writing/proposal-rest", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/writing/proposal-rest")>(),
  refreshedProposal: mocks.refreshed,
}));
vi.mock("@/lib/agents/run-template-via-rtx", () => ({
  getRtxRefsFromRunConfig: mocks.refs,
}));

import { POST as materializePost } from "@/app/api/variants/[id]/materialize/route";
import { POST as rejectPost } from "@/app/api/variants/[id]/reject/route";
import { POST as revisionPost } from "@/app/api/variants/[id]/request-revision/route";

const context = { params: Promise.resolve({ id: "variant_123" }) };

function request(body: unknown) {
  return new Request("http://signals.local/api/variants/variant_123/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("proposal decision REST wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshed.mockReturnValue({
      workflowRunId: "run_123",
      proposal: { variantId: "variant_123" },
      run: { config: JSON.stringify({ rtxWorkspaceSlug: "signals", rtxThreadSlug: "nurture" }) },
    });
    mocks.refs.mockReturnValue({ workspaceSlug: "signals", threadSlug: "nurture" });
    mocks.materialize.mockResolvedValue({
      contentItemId: "content_123",
      created: true,
      updated: false,
      nextAction: "export",
      capability: { publish: "draft_only" },
    });
  });

  it("materializes with server-shaped UI approval evidence", async () => {
    const response = await materializePost(request({
      route: "/dashboard/workflows/run_123",
      note: "Looks good",
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.materialize).toHaveBeenCalledWith({
      variantId: "variant_123",
      approval: {
        by: "user",
        evidence: { kind: "ui", route: "/dashboard/workflows/run_123" },
        note: "Looks good",
      },
    });
    expect(await response.json()).toMatchObject({
      contentItemId: "content_123",
      nextAction: "export",
      proposal: { variantId: "variant_123" },
    });
  });

  it("rejects a caller route outside the dashboard proposal surfaces", async () => {
    const response = await materializePost(request({ route: "/api/agent-tools/invoke" }), context);
    expect(response.status).toBe(400);
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("passes AgentToolError codes and reasons through the shared status map", async () => {
    mocks.materialize.mockRejectedValueOnce(new AgentToolError(
      "AUDIT_STALE",
      "The proposal audit is stale",
      { reason: "audit_input_stale" },
    ));
    const response = await materializePost(request({
      route: "/dashboard/workflows/run_123",
    }), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The proposal audit is stale",
      code: "AUDIT_STALE",
      details: { reason: "audit_input_stale" },
    });
  });

  it("persists rejection evidence and an optional note", async () => {
    const response = await rejectPost(request({
      route: "/dashboard/launches/launch_123",
      note: "Not for this contact",
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.reject).toHaveBeenCalledWith("variant_123", {
      evidence: { kind: "ui", route: "/dashboard/launches/launch_123" },
      note: "Not for this contact",
    });
  });

  it("requires a revision note and returns the anchoring run thread", async () => {
    const invalid = await revisionPost(request({
      route: "/dashboard/workflows/run_123",
      note: "",
    }), context);
    expect(invalid.status).toBe(400);
    expect(mocks.revision).not.toHaveBeenCalled();

    const response = await revisionPost(request({
      route: "/dashboard/workflows/run_123",
      note: "Use the launch detail",
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.revision).toHaveBeenCalledWith("variant_123", {
      evidence: { kind: "ui", route: "/dashboard/workflows/run_123" },
      note: "Use the launch detail",
    });
    expect(await response.json()).toMatchObject({
      thread: {
        workspaceSlug: "signals",
        threadSlug: "nurture",
        threadPath: "/workspace/signals/t/nurture",
      },
    });
  });
});
