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
      if (url.endsWith("/cli/list-workspaces") && init?.method === "GET") {
        return new Response(JSON.stringify({ workspaces: [] }), { status: 200 });
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2]?.[0]).toContain("/cli/create-workspace");
  });

  it("reuses an existing workspace by name when the preferred slug is missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-workspaces") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            workspaces: [
              { slug: "signals-2", name: "Signals (2)" },
              { slug: "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f", name: "Signals" },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/cli/create-workspace")) {
        return new Response(JSON.stringify({ error: "should not create" }), { status: 500 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const slug = await ensureRtxWorkspace(
      "signals",
      "Signals",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
      fetchImpl
    );

    expect(slug).toBe("f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the resolved slug when create-workspace dedupes the requested slug", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-workspaces") && init?.method === "GET") {
        return new Response(JSON.stringify({ workspaces: [] }), { status: 200 });
      }
      if (url.endsWith("/cli/create-workspace") && init?.method === "POST") {
        return new Response(JSON.stringify({ workspace: { slug: "signals-2" } }), {
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

    expect(slug).toBe("signals-2");
  });
});
