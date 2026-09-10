import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetOrchestratorThreadCacheForTests,
  DEFAULT_ORCHESTRATOR_THREAD_SLUG,
  getOrCreateOrchestratorThread,
  SIGNALS_ORCHESTRATOR_THREAD_NAME,
} from "./orchestrator-thread";

describe("Signals Orchestrator Thread Provisioning", () => {
  beforeEach(() => {
    _resetOrchestratorThreadCacheForTests();
    delete process.env.SIGNALS_ORCHESTRATOR_THREAD_SLUG;
  });

  it("reuses existing orchestrator thread when presence is exists", async () => {
    const mockFetch = (async (url: string) => {
      if (url.includes("/cli/get-thread/")) {
        return new Response(JSON.stringify({ thread: { slug: "signals-orchestrator" } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch;

    const result = await getOrCreateOrchestratorThread(
      { workspaceSlug: "signals" },
      { RTX_APP_ID: "app-test", RTX_API_BASE: "http://localhost:3001/api" },
      mockFetch
    );

    expect(result.threadSlug).toBe(DEFAULT_ORCHESTRATOR_THREAD_SLUG);
    expect(result.threadName).toBe(SIGNALS_ORCHESTRATOR_THREAD_NAME);
    expect(result.resolution).toBe("reused");
  });

  it("resolves the host workspace slug before looking up the orchestrator thread", async () => {
    const workspaceSlug = "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f";
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-workspaces") && init?.method === "GET") {
        return new Response(
          JSON.stringify({ workspaces: [{ slug: workspaceSlug, name: "Signals" }] }),
          { status: 200 },
        );
      }
      if (
        url.includes(`/cli/get-thread/${workspaceSlug}/`) &&
        init?.method === "GET"
      ) {
        return new Response(
          JSON.stringify({ thread: { slug: DEFAULT_ORCHESTRATOR_THREAD_SLUG } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "Unexpected request" }), { status: 500 });
    }) as unknown as typeof fetch;

    const result = await getOrCreateOrchestratorThread(
      undefined,
      { RTX_APP_ID: "app-test", RTX_API_BASE: "http://localhost:3001/api" },
      mockFetch,
    );

    expect(result).toMatchObject({
      workspaceSlug,
      threadSlug: DEFAULT_ORCHESTRATOR_THREAD_SLUG,
      resolution: "reused",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("provisions a new orchestrator thread when missing in RealTimeX", async () => {
    const mockFetch = (async (url: string, init?: RequestInit) => {
      if (url.includes("/cli/get-thread/")) {
        return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
      }
      if (url.includes("/cli/create-thread/")) {
        return new Response(JSON.stringify({ thread: { slug: "signals-orchestrator-new" } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 400 });
    }) as unknown as typeof fetch;

    const result = await getOrCreateOrchestratorThread(
      { workspaceSlug: "signals" },
      { RTX_APP_ID: "app-test", RTX_API_BASE: "http://localhost:3001/api" },
      mockFetch
    );

    expect(result.threadSlug).toBe("signals-orchestrator-new");
    expect(result.resolution).toBe("recreated");
  });

  it("falls back to default slug when RealTimeX API is offline", async () => {
    const offlineFetch = (async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const result = await getOrCreateOrchestratorThread(
      { workspaceSlug: "signals" },
      { RTX_APP_ID: "app-test", RTX_API_BASE: "http://localhost:3001/api" },
      offlineFetch
    );

    expect(result.threadSlug).toBe(DEFAULT_ORCHESTRATOR_THREAD_SLUG);
    expect(result.resolution).toBe("fallback");
  });
});
