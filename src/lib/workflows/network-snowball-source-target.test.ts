import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBrowserConnection } from "@/lib/db/queries/platform-targets";
import { getSessionLeaseById } from "@/lib/leases/session-lease";
import {
  prepareNetworkSnowballSourceTarget,
  releaseNetworkSnowballSourceTarget,
} from "@/lib/workflows/network-snowball-source-target";
import { resetCoreTables } from "@/test/db";

describe("Network Snowball generic source target", () => {
  beforeEach(() => resetCoreTables());

  it("never creates or substitutes an unregistered selected session", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await prepareNetworkSnowballSourceTarget(
      {
        workflowRunId: "run-missing",
        sessionName: "personal-browser",
        startUrl: "https://events.example.test/member-night",
      },
      { RTX_APP_ID: "test-app-id", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "CONNECTION_UNAVAILABLE",
        details: { sessionName: "personal-browser" },
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("leases the exact registered, running session and leaves release to Signals", async () => {
    ensureBrowserConnection({ sessionName: "personal-browser", kind: "dedicated" });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      sessions: [
        { sessionName: "signals-publish", running: true, remoteDebugPort: 9221 },
        { sessionName: "personal-browser", running: true, remoteDebugPort: 9222 },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await prepareNetworkSnowballSourceTarget(
      {
        workflowRunId: "run-exact",
        sessionName: "personal-browser",
        startUrl: "https://events.example.test/member-night",
      },
      { RTX_APP_ID: "test-app-id", RTX_API_BASE_URL: "http://127.0.0.1:3001" },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.target).toMatchObject({
      source: "participant_access",
      sessionName: "personal-browser",
      startUrl: "https://events.example.test/member-night",
    });
    expect(result.target.sessionName).not.toBe("signals-publish");
    expect(getSessionLeaseById(result.target.leaseId)).toMatchObject({
      holder: "network-snowball-source:run-exact",
      intent: "browse",
      targetId: null,
    });

    expect(releaseNetworkSnowballSourceTarget(result.target.leaseId)).toEqual({
      leaseId: result.target.leaseId,
      released: true,
      alreadyGone: false,
    });
    expect(getSessionLeaseById(result.target.leaseId)).toBeUndefined();
  });
});
