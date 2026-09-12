import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRtxBrowserSessions: vi.fn(),
  listBrowserConnections: vi.fn(),
  resolveDefaultTarget: vi.fn(),
  getBrowserConnectionById: vi.fn(),
}));

vi.mock("@/lib/rtx/browser-sessions", () => ({
  listRtxBrowserSessions: mocks.listRtxBrowserSessions,
  resolveRtxDebugPort: (entry: { remoteDebugPort?: number }) => entry.remoteDebugPort ?? null,
}));

vi.mock("@/lib/db/queries/platform-targets", () => ({
  listBrowserConnections: mocks.listBrowserConnections,
  resolveDefaultTarget: mocks.resolveDefaultTarget,
  getBrowserConnectionById: mocks.getBrowserConnectionById,
}));

import { GET } from "@/app/api/workflows/network-snowball/source-sessions/route";

describe("GET Network Snowball source sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRtxBrowserSessions.mockResolvedValue([
      { sessionName: "registered-running", running: true, remoteDebugPort: 9222 },
      { sessionName: "unregistered-running", running: true, remoteDebugPort: 9333 },
      { sessionName: "registered-stopped", running: false },
    ]);
    mocks.listBrowserConnections.mockReturnValue([
      { id: "connection-source", sessionName: "registered-running" },
      { id: "connection-stopped", sessionName: "registered-stopped" },
    ]);
    mocks.resolveDefaultTarget.mockReturnValue({
      connectionId: "connection-crm",
      handle: "/in/crm-writer",
      name: "CRM Writer",
      lastVerifiedAt: 1_700_000_000,
    });
    mocks.getBrowserConnectionById.mockReturnValue({ sessionName: "crm-linkedin" });
  });

  it("returns only registered running source sessions and a separate CRM target", async () => {
    const response = await GET(new Request(
      "http://localhost/api/workflows/network-snowball/source-sessions?targetPlatform=linkedin",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessions: [{
        sessionName: "registered-running",
        running: true,
        sourceIdentity: null,
        identityVerification: "checked_at_launch",
      }],
      crmTarget: {
        platform: "linkedin",
        sessionName: "crm-linkedin",
        identity: "/in/crm-writer",
        verification: "previously_verified",
      },
    });
  });
});
