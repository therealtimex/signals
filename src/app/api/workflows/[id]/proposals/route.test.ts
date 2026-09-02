import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  list: vi.fn(),
  summarize: vi.fn(),
}));

vi.mock("@/lib/db/queries/workflows", () => ({
  getWorkflowRun: mocks.getRun,
}));
vi.mock("@/lib/writing/workflow-run-proposals", () => ({
  listWorkflowRunProposals: mocks.list,
  summarizeWorkflowRunProposals: mocks.summarize,
}));

import { GET } from "@/app/api/workflows/[id]/proposals/route";

function context(id = "run_123") {
  return { params: Promise.resolve({ id }) };
}

describe("workflow run proposals GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRun.mockReturnValue({ id: "run_123" });
    mocks.summarize.mockReturnValue({ total: 1, pendingReview: 1 });
    mocks.list.mockReturnValue({
      launches: [{ id: "launch_123" }],
      proposals: [{ variantId: "variant_123" }],
      summary: { total: 1, pendingReview: 1 },
    });
  });

  it("returns 404 without evaluating proposal discovery for an unknown run", async () => {
    mocks.getRun.mockReturnValue(null);

    const response = await GET(new Request("http://signals.local"), context("missing"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Workflow run not found" });
    expect(mocks.summarize).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns an explicit null summary for a run without writing composition", async () => {
    mocks.summarize.mockReturnValue(null);

    const response = await GET(new Request("http://signals.local"), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ launches: [], proposals: [], summary: null });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns the authoritative run-anchored proposal projection", async () => {
    const response = await GET(new Request("http://signals.local"), context());

    expect(response.status).toBe(200);
    expect(mocks.summarize).toHaveBeenCalledWith("run_123");
    expect(mocks.list).toHaveBeenCalledWith("run_123");
    expect(await response.json()).toMatchObject({
      proposals: [{ variantId: "variant_123" }],
      summary: { total: 1, pendingReview: 1 },
    });
  });
});
