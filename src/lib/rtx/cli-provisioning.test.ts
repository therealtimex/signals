import { describe, expect, it, vi } from "vitest";
import {
  ensureRtxWorkspace,
  getWorkspaceDefaultTerminalAgent,
  parseWorkspaceDefaultTerminalAgent,
  resolveSignalsRtxWorkspaceSlug,
} from "@/lib/rtx/cli-provisioning";

describe("resolveSignalsRtxWorkspaceSlug", () => {
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
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const slug = await resolveSignalsRtxWorkspaceSlug(
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
      fetchImpl
    );

    expect(slug).toBe("f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

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

describe("parseWorkspaceDefaultTerminalAgent", () => {
  it("parses workspace_configs.defaultAgent JSON", () => {
    const agent = parseWorkspaceDefaultTerminalAgent({
      workspace: {
        workspace_configs: {
          defaultAgent: JSON.stringify({
            id: "terminal-antigravity",
            name: "antigravity",
            terminal: {
              providerId: "antigravity-cli",
              modelId: "gemini-3.7-flash-high",
            },
          }),
        },
      },
    });

    expect(agent).toEqual({
      agentName: "antigravity",
      agentId: "terminal-antigravity",
      providerId: "antigravity-cli",
      modelId: "gemini-3.7-flash-high",
    });
  });
});

describe("getWorkspaceDefaultTerminalAgent", () => {
  it("loads the workspace default terminal agent via get-workspace", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            workspace: {
              workspace_configs: {
                defaultAgent: {
                  id: "terminal-antigravity",
                  name: "antigravity",
                  terminal: { providerId: "antigravity-cli", defaultModelId: "gemini-3.7-flash-high" },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    await expect(
      getWorkspaceDefaultTerminalAgent(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl
      )
    ).resolves.toEqual({
      agentName: "antigravity",
      agentId: "terminal-antigravity",
      providerId: "antigravity-cli",
      modelId: "gemini-3.7-flash-high",
    });
  });
});

describe("resolveNetworkSnowballDispatchThread", () => {
  it("reuses the legacy network-snowball slug when it exists", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball") && init?.method === "GET") {
        return new Response(JSON.stringify({ thread: { slug: "network-snowball" } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    await expect(
      resolveNetworkSnowballDispatchThread(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).resolves.toBe("network-snowball");
  });

  it("reuses an existing Network Snowball thread by name", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals") && init?.method === "GET") {
        return new Response(
          JSON.stringify({
            threads: [
              {
                slug: "f0238db7-6620-4452-9a91-bcdb9dd23fdd",
                name: "Network Snowball",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    await expect(
      resolveNetworkSnowballDispatchThread(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).resolves.toBe("f0238db7-6620-4452-9a91-bcdb9dd23fdd");
  });

  it("returns a trimmed slug and never creates on a failed listing", async () => {
    const created: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals")) {
        return new Response(
          JSON.stringify({
            threads: [{ slug: "  f0238db7-padded  ", name: "Network Snowball" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/cli/create-thread")) {
        created.push(url);
        return new Response(JSON.stringify({ thread: { slug: "created" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    // A padded slug must come back usable, not with its whitespace intact.
    await expect(
      resolveNetworkSnowballDispatchThread(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).resolves.toBe("f0238db7-padded");
    expect(created).toHaveLength(0);
  });

  it("falls back to the legacy slug when presence itself is unknown", async () => {
    const created: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball")) {
        // Unknown, not confirmed-missing: the legacy thread may well exist.
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      if (url.endsWith("/cli/list-threads/signals")) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      if (url.includes("/cli/create-thread")) {
        created.push(url);
        return new Response(JSON.stringify({ thread: { slug: "created" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    await expect(
      resolveNetworkSnowballDispatchThread(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).resolves.toBe("network-snowball");
    expect(created).toHaveLength(0);
  });

  it("fails instead of returning a thread confirmed to be missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball")) {
        // Confirmed missing, not unknown.
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals")) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    // Returning the legacy slug here would queue calendar events against a thread
    // that cannot exist; the seeds would be claimed and deduped, never retried.
    await expect(
      resolveNetworkSnowballDispatchThread(
        "signals",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).rejects.toThrow(/could not list workspace threads/i);
  });

  it("converges concurrent resolvers on one slug", async () => {
    let createCalls = 0;
    const threads: Array<{ slug: string; name: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/cli/get-thread/signals/network-snowball")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals")) {
        return new Response(JSON.stringify({ threads: [...threads] }), { status: 200 });
      }
      if (url.includes("/cli/create-thread")) {
        createCalls += 1;
        const slug = `created-${createCalls}`;
        threads.push({ slug, name: "Network Snowball" });
        return new Response(JSON.stringify({ thread: { slug } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolveNetworkSnowballDispatchThread } = await import("@/lib/rtx/cli-provisioning");
    const env = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" };
    const [a, b] = await Promise.all([
      resolveNetworkSnowballDispatchThread("signals", env, fetchImpl),
      resolveNetworkSnowballDispatchThread("signals", env, fetchImpl),
    ]);

    // Splitting the first two dispatches across two threads is the failure mode.
    expect(a).toBe(b);
    expect(createCalls).toBe(1);
  });
});

describe("resolvePersonaGenerationDispatchThread", () => {
  it("reuses the dedicated thread and recreates it after deletion", async () => {
    let createCalls = 0;
    const threads: Array<{ slug: string; name: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/cli/get-thread/signals/persona-generation")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals")) {
        return new Response(JSON.stringify({ threads: [...threads] }), { status: 200 });
      }
      if (url.includes("/cli/create-thread/signals")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { name?: string };
        const name = body.name ?? "";
        expect(name).toBe("Persona Generation");
        createCalls += 1;
        const thread = { slug: `persona-created-${createCalls}`, name };
        threads.push(thread);
        return new Response(JSON.stringify({ thread }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolvePersonaGenerationDispatchThread } = await import(
      "@/lib/rtx/cli-provisioning"
    );
    const env = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" };
    const first = await resolvePersonaGenerationDispatchThread("signals", env, fetchImpl);
    const reused = await resolvePersonaGenerationDispatchThread("signals", env, fetchImpl);

    expect(first).toBe("persona-created-1");
    expect(reused).toBe(first);
    expect(createCalls).toBe(1);

    threads.length = 0;
    const recreated = await resolvePersonaGenerationDispatchThread(
      "signals",
      env,
      fetchImpl,
    );
    expect(recreated).toBe("persona-created-2");
    expect(createCalls).toBe(2);
  });

  it("coalesces concurrent first-use resolution on one thread", async () => {
    let createCalls = 0;
    const threads: Array<{ slug: string; name: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/cli/get-thread/signals-concurrent/persona-generation")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals-concurrent")) {
        return new Response(JSON.stringify({ threads: [...threads] }), { status: 200 });
      }
      if (url.includes("/cli/create-thread/signals-concurrent")) {
        createCalls += 1;
        const thread = {
          slug: `persona-created-${createCalls}`,
          name: "Persona Generation",
        };
        threads.push(thread);
        return new Response(JSON.stringify({ thread }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolvePersonaGenerationDispatchThread } = await import(
      "@/lib/rtx/cli-provisioning"
    );
    const env = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" };
    const [first, second] = await Promise.all([
      resolvePersonaGenerationDispatchThread("signals-concurrent", env, fetchImpl),
      resolvePersonaGenerationDispatchThread("signals-concurrent", env, fetchImpl),
    ]);

    expect(first).toBe(second);
    expect(first).toBe("persona-created-1");
    expect(createCalls).toBe(1);
  });

  it("does not create a duplicate when thread listing fails transiently", async () => {
    let createCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/cli/get-thread/signals-list-failure/persona-generation")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-threads/signals-list-failure")) {
        return new Response(JSON.stringify({ error: "temporarily unavailable" }), {
          status: 503,
        });
      }
      if (url.includes("/cli/create-thread/signals-list-failure")) {
        createCalls += 1;
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { resolvePersonaGenerationDispatchThread } = await import(
      "@/lib/rtx/cli-provisioning"
    );
    await expect(
      resolvePersonaGenerationDispatchThread(
        "signals-list-failure",
        { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3101" },
        fetchImpl,
      ),
    ).rejects.toThrow(/could not list workspace threads/i);
    expect(createCalls).toBe(0);
  });
});
