import { describe, expect, it, vi } from "vitest";
import { createTemplate, getTemplate } from "@/lib/db/queries/workflow-templates";
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

/** Minimal RTX CLI API stub: `get-thread` presence + `create-thread`. */
function stubRtxApi(options: { getThreadStatus?: number; createdSlug?: string }) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/cli/get-thread/")) {
      const status = options.getThreadStatus ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({}),
      };
    }
    if (url.includes("/cli/create-thread/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ thread: { slug: options.createdSlug ?? "thread-new" } }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
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

    expect(result).toEqual({ threadSlug: "thread-abc", resolution: "created" });
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

    expect(result).toEqual({ threadSlug: "thread-abc", resolution: "reused" });
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

    expect(result).toEqual({ threadSlug: "thread-fresh", resolution: "recreated" });
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

    expect(result).toEqual({ threadSlug: "thread-abc", resolution: "reused" });
    expect(calls.some((url) => url.includes("/cli/create-thread/"))).toBe(false);
  });

  it("uses a throwaway thread without repointing the template", async () => {
    const template = makeTemplate("thread-abc");
    const { fetchImpl, calls } = stubRtxApi({ createdSlug: "thread-oneoff" });

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

    expect(result).toEqual({ threadSlug: "thread-oneoff", resolution: "fresh" });
    expect(getTemplate(template.id)?.rtxThreadSlug).toBe("thread-abc");
    expect(calls.some((url) => url.includes("/cli/get-thread/"))).toBe(false);
  });
});
