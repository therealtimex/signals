import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  openLauncher: vi.fn(),
}));

vi.mock("@/lib/db/queries/workflows", () => ({
  getWorkflowRun: mocks.getRun,
}));
vi.mock("@/lib/rtx/runtime-sessions", () => ({
  openRtxRuntimeLauncher: mocks.openLauncher,
}));

import { POST } from "@/app/api/workflows/runs/[id]/open-thread/route";

function context(id = "run-1") {
  return { params: Promise.resolve({ id }) };
}

describe("workflow run open-thread POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openLauncher.mockResolvedValue({ success: true });
  });

  it("opens only the authoritative workspace/thread pair stored on the run", async () => {
    mocks.getRun.mockReturnValue({
      id: "run-1",
      config: JSON.stringify({
        rtxWorkspaceSlug: "signals",
        rtxThreadSlug: "network-snowball",
        rtxRuntimeSessionId: "cli-agent:not-the-thread-identity",
      }),
    });

    const response = await POST(new Request("http://signals.local"), context());

    expect(response.status).toBe(200);
    expect(mocks.openLauncher).toHaveBeenCalledWith({
      workspaceSlug: "signals",
      threadSlug: "network-snowball",
      presentationMode: "tab",
      reason: "Open workflow run run-1",
    });
    expect(await response.json()).toMatchObject({
      success: true,
      threadPath: "/workspace/signals/t/network-snowball",
    });
  });

  it("rejects a runtime session ID without a complete stored thread target", async () => {
    mocks.getRun.mockReturnValue({
      id: "run-1",
      config: JSON.stringify({ rtxRuntimeSessionId: "cli-agent:session-only" }),
    });

    const response = await POST(new Request("http://signals.local"), context());

    expect(response.status).toBe(400);
    expect(mocks.openLauncher).not.toHaveBeenCalled();
  });
});
