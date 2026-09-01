import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  readPersonalityWorkspaceFiles,
  resolvePersonalityWorkspace,
  resolvePersonalityWorkspaceContext,
} from "@/lib/personality/workspace";
import {
  clearHostCapabilityCache,
  probeHostCapabilities,
} from "@/lib/rtx/capabilities";

const roots: string[] = [];

function fixture() {
  const storage = mkdtempSync(join(tmpdir(), "signals-378-workspace-"));
  roots.push(storage);
  mkdirSync(join(storage, "working-data", "signals"), { recursive: true });
  const env = {
    RTX_APP_ID: "signals-app",
    RTX_API_BASE_URL: "http://rtx.test",
    STORAGE_DIR: storage,
    SIGNALS_RTX_WORKSPACE_SLUG: "signals",
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    workspace: { id: 42, slug: "signals", name: "Signals GTM" },
  }), { status: 200, headers: { "content-type": "application/json" } });
  return { storage, env, fetchImpl: fetchImpl as typeof fetch };
}

afterEach(() => {
  clearHostCapabilityCache();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Personality workspace resolution", () => {
  it("pins exact host slug/id and contained real directory without writer permission", async () => {
    const { storage, env, fetchImpl } = fixture();
    const workspace = await resolvePersonalityWorkspace(env, fetchImpl);
    expect(workspace).toMatchObject({ slug: "signals", id: "42" });
    expect(workspace.dir).toBe(realpathSync(join(storage, "working-data", "signals")));
    expect(workspace.key).toMatch(/^[a-f0-9]{32}$/);
    expect(readPersonalityWorkspaceFiles(workspace)).toHaveLength(5);
    await expect(resolvePersonalityWorkspaceContext(env, fetchImpl)).resolves.toMatchObject({
      displayName: "Signals GTM",
      workspace: { slug: "signals", id: "42" },
    });
  });

  it("resolves the existing Signals workspace by name when its slug is host-generated", async () => {
    const storage = mkdtempSync(join(tmpdir(), "signals-381-workspace-"));
    roots.push(storage);
    const resolvedSlug = "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f";
    mkdirSync(join(storage, "working-data", resolvedSlug), { recursive: true });
    const env = {
      RTX_APP_ID: "signals-app",
      RTX_API_BASE_URL: "http://rtx.test",
      STORAGE_DIR: storage,
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.endsWith("/cli/get-workspace/signals") && init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (url.endsWith("/cli/list-workspaces") && init?.method === "GET") {
        return new Response(JSON.stringify({
          workspaces: [{ slug: resolvedSlug, name: "Signals" }],
        }), { status: 200 });
      }
      if (url.endsWith(`/cli/get-workspace/${resolvedSlug}`) && init?.method === "GET") {
        return new Response(JSON.stringify({
          workspace: { id: 46, slug: resolvedSlug, name: "Signals" },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    await expect(resolvePersonalityWorkspaceContext(env, fetchImpl)).resolves.toMatchObject({
      displayName: "Signals",
      workspace: { slug: resolvedSlug, id: "46" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects target aliases, symlinks, invalid UTF-8, and workspace symlinks", async () => {
    const { storage, env, fetchImpl } = fixture();
    const workspace = await resolvePersonalityWorkspace(env, fetchImpl);
    writeFileSync(join(workspace.dir, "identity.md"), "alias");
    expect(() => readPersonalityWorkspaceFiles(workspace)).toThrowError(AgentToolError);
    rmSync(join(workspace.dir, "identity.md"));
    symlinkSync("elsewhere", join(workspace.dir, "VOICE.md"));
    expect(() => readPersonalityWorkspaceFiles(workspace)).toThrowError(AgentToolError);
    rmSync(join(workspace.dir, "VOICE.md"));
    writeFileSync(join(workspace.dir, "BRAND.md"), Buffer.from([0xff]));
    expect(() => readPersonalityWorkspaceFiles(workspace)).toThrowError(AgentToolError);

    rmSync(join(storage, "working-data", "signals"), { recursive: true, force: true });
    mkdirSync(join(storage, "elsewhere"));
    symlinkSync(join(storage, "elsewhere"), join(storage, "working-data", "signals"));
    await expect(resolvePersonalityWorkspace(env, fetchImpl)).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
    });
  });
});

function capabilityResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    apiVersion: 1,
    capabilities: {
      "workspace.personality.transactions": {
        version: 1,
        schemaVersions: [1],
        permission: "workspace.personality.write",
        granted: true,
        fileHash: "sha256-hex",
        maxFiles: 16,
        maxFileBytes: 1024 * 1024,
        allowlist: {
          pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}\\.md$",
          excluded: ["HEARTBEAT.md", "MEMORY.md", "CLAUDE.md"],
        },
        ...overrides,
      },
    },
  };
}

describe("Personality host capability negotiation", () => {
  const env = { RTX_APP_ID: "signals-app", RTX_API_BASE_URL: "http://rtx.test" };

  it("distinguishes available, not-granted, unsupported, and unreachable states", async () => {
    const response = (body: unknown, status = 200) => async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    await expect(probeHostCapabilities({
      env,
      fetchImpl: response(capabilityResponse()) as typeof fetch,
      uncached: true,
    })).resolves.toMatchObject({ state: "available", version: 1, maxFiles: 16 });
    await expect(probeHostCapabilities({
      env,
      fetchImpl: response(capabilityResponse({ granted: false })) as typeof fetch,
      uncached: true,
    })).resolves.toMatchObject({ state: "not_granted", reason: "permission_not_granted" });
    await expect(probeHostCapabilities({
      env,
      fetchImpl: response(capabilityResponse({ schemaVersions: [2] })) as typeof fetch,
      uncached: true,
    })).resolves.toMatchObject({ state: "unsupported", reason: "incompatible_contract" });
    await expect(probeHostCapabilities({ env: {}, uncached: true })).resolves.toMatchObject({
      state: "unreachable",
    });
  });

  it("caches status probes for at most thirty seconds but bypasses cache for submit", async () => {
    let calls = 0;
    let now = 1_000;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(capabilityResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await probeHostCapabilities({ env, fetchImpl, now: () => now });
    await probeHostCapabilities({ env, fetchImpl, now: () => now + 29_999 });
    expect(calls).toBe(1);
    now += 30_001;
    await probeHostCapabilities({ env, fetchImpl, now: () => now });
    await probeHostCapabilities({ env, fetchImpl, now: () => now, uncached: true });
    expect(calls).toBe(3);
  });
});
