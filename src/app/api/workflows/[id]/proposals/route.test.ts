import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  list: vi.fn(),
  summarize: vi.fn(),
  observe: vi.fn(),
}));

vi.mock("@/lib/db/queries/workflows", () => ({
  getWorkflowRun: mocks.getRun,
}));
vi.mock("@/lib/writing/workflow-run-proposals", () => ({
  listWorkflowRunProposals: mocks.list,
  summarizeWorkflowRunProposals: mocks.summarize,
}));

vi.mock("@/lib/writing/objective-sources", () => ({
  observeObjectiveSourcesForRun: mocks.observe,
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
    mocks.observe.mockResolvedValue(null);
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
    expect(await response.json()).toEqual({
      launches: [],
      objective: null,
      objectiveSource: null,
      proposals: [],
      summary: null,
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it("returns the authoritative run-anchored proposal projection", async () => {
    const response = await GET(new Request("http://signals.local"), context());

    expect(response.status).toBe(200);
    expect(mocks.summarize).toHaveBeenCalledWith("run_123");
    expect(mocks.observe).toHaveBeenCalledWith("run_123");
    expect(mocks.list).toHaveBeenCalledWith("run_123", {});
    expect(await response.json()).toMatchObject({
      proposals: [{ variantId: "variant_123" }],
      summary: { total: 1, pendingReview: 1 },
    });
  });

  it("observes the objective sources first and projects that observation (#549)", async () => {
    const objectiveSource = { status: "stale", changedPaths: ["BRAND.md"], observedAt: 1_800_000_000 };
    mocks.observe.mockResolvedValue({ objectiveSource, revokedVariantIds: [] });

    await GET(new Request("http://signals.local"), context());

    expect(mocks.list).toHaveBeenCalledWith("run_123", { objectiveSource });
    expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.list.mock.invocationCallOrder[0]);
  });
});
