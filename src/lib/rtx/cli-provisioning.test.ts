import { describe, expect, it, vi } from "vitest";
import { ensureRtxWorkspace } from "@/lib/rtx/cli-provisioning";

describe("ensureRtxWorkspace", () => {
  it("reuses an existing workspace via get-workspace without create-workspace", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const slug = await ensureRtxWorkspace(
      "signals",
      "Signals",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
      fetchImpl
    );

    expect(slug).toBe("signals");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/cli/get-workspace/signals");
  });

  it("creates the workspace only when get-workspace returns 404", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/create-workspace") && init?.method === "POST") {
        return new Response(JSON.stringify({ workspace: { slug: "signals" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const slug = await ensureRtxWorkspace(
      "signals",
      "Signals",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
      fetchImpl
    );

    expect(slug).toBe("signals");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/cli/create-workspace");
  });
});
