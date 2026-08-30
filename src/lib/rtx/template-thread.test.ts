import { describe, expect, it, vi } from "vitest";
import {
  claimTemplateThreadSlug,
  createTemplate,
  getTemplate,
} from "@/lib/db/queries/workflow-templates";
import { getOrCreateTemplateThread } from "@/lib/rtx/template-thread";
import { resetCoreTables } from "@/test/db";

const ENV = {
  RTX_APP_ID: "test-app-id",
  RTX_API_BASE_URL: "http://127.0.0.1:3001",
};

function makeTemplate(rtxThreadSlug: string | null = null) {
  resetCoreTables();
  const template = createTemplate({
    name: "Top AI Influencers",
    templateType: "prospecting",
    status: "active",
    config: "{}",
    isSystem: 0,
    rtxThreadSlug,
  });
  return template;
}

/** Minimal RTX CLI API stub: thread lookup, create, and rename. */
function stubRtxApi(options: {
  getThreadStatus?: number;
  getThreadName?: string | null;
  createdSlug?: string;
  renameStatus?: number;
}) {
  const calls: string[] = [];
  const createdNames: string[] = [];
  const renamedNames: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/cli/get-thread/")) {
      const status = options.getThreadStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({
          thread: {
            name:
              options.getThreadName === undefined
                ? "Top AI Influencers"
                : options.getThreadName,
          },
        }),
      };
    }
    if (url.includes("/cli/rename-thread/")) {
      renamedNames.push(
        JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")).name,
      );
      const status = options.renameStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => status >= 400 ? { error: "rename failed" } : { success: true },
      };
    }
    if (url.includes("/cli/create-thread/")) {
      createdNames.push(
        JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")).name,
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ thread: { slug: options.createdSlug ?? "thread-new" } }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, createdNames, renamedNames };
}

describe("getOrCreateTemplateThread", () => {
  it("creates and persists a dedicated thread on the first run", async () => {
    const template = makeTemplate();
    const { fetchImpl, calls } = stubRtxApi({ createdSlug: "thread-abc" });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({
      threadSlug: "thread-abc",
      resolution: "created",
      threadName: "Top AI Influencers",
      renameAttempted: false,
      renamed: false,
    });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
    expect(calls.some((url) => url.includes("/cli/get-thread/"))).toBe(false);
  });

  it("reuses the stored thread when it still exists", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl, calls } = stubRtxApi({ getThreadStatus: 200 });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({
      threadSlug: "thread-abc",
      resolution: "reused",
      renameAttempted: false,
      renamed: false,
    });
    expect(calls.some((url) => url.includes("/cli/create-thread/"))).toBe(false);
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
  });

  it("recreates and repoints when the stored thread was deleted", async () => {
    const template = makeTemplate("thread-gone");
    const { fetchImpl } = stubRtxApi({
      getThreadStatus: 404,
      createdSlug: "thread-fresh",
    });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({ threadSlug: "thread-fresh", resolution: "recreated" });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-fresh");
  });

  it("keeps the stored thread when the presence check is inconclusive", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl, calls } = stubRtxApi({ getThreadStatus: 500 });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({
      threadSlug: "thread-abc",
      resolution: "reused",
      renameAttempted: false,
    });
    expect(calls.some((url) => url.includes("/cli/create-thread/"))).toBe(false);
  });

  it("uses a throwaway thread without repointing the template", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl, calls, createdNames } = stubRtxApi({ createdSlug: "thread-oneoff" });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
        freshThread: true,
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({ threadSlug: "thread-oneoff", resolution: "fresh" });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
    expect(calls.some((url) => url.includes("/cli/get-thread/"))).toBe(false);
    expect(createdNames).toEqual(["Top AI Influencers — one-off"]);
  });

  it("joins the winner's thread when a concurrent run claims the pointer first", async () => {
    const template = makeTemplate();
    const { fetchImpl } = stubRtxApi({ createdSlug: "thread-loser" });

    // Simulate the race: another run persists its own thread while we are provisioning.
    const cliProvisioning = await import("@/lib/rtx/cli-provisioning");
    vi.spyOn(cliProvisioning, "createRtxPublishThread").mockImplementation(async () => {
      claimTemplateThreadSlug(template.id, null, "thread-winner");
      return "thread-loser";
    });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Top AI Influencers",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({ threadSlug: "thread-winner", resolution: "reused" });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-winner");
    vi.restoreAllMocks();
  });

  it("renames a reused thread in place without changing its slug", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl, renamedNames } = stubRtxApi({
      getThreadName: "Contact Web Research",
    });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Contact Enrich Profile",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({
      threadSlug: "thread-abc",
      resolution: "reused",
      threadName: "Contact Enrich Profile",
      renameAttempted: true,
      renamed: true,
    });
    expect(renamedNames).toEqual(["Contact Enrich Profile"]);
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
  });

  it("keeps dispatching on the bound slug when rename fails", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl } = stubRtxApi({
      getThreadName: "Contact Web Research",
      renameStatus: 500,
    });

    const result = await getOrCreateTemplateThread(
      {
        template,
        workspaceSlug: "signals",
        threadName: "Contact Enrich Profile",
      },
      ENV,
      fetchImpl,
    );

    expect(result).toMatchObject({
      threadSlug: "thread-abc",
      resolution: "reused",
      renameAttempted: true,
      renamed: false,
      renameError: "rename failed",
    });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
  });
});
