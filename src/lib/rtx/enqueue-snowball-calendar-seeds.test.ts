import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueSnowballCalendarSeeds,
  formatSnowballCalendarTitle,
} from "@/lib/rtx/enqueue-snowball-calendar-seeds";
import { resetCoreTables } from "@/test/db";
import { readSnowballSeedScoutConfig } from "@/lib/workflows/snowball-seed-scout";
import { buildSnowballSeedScoutTemplateConfig } from "@/lib/workflows/snowball-seed-scout";

vi.mock("@/lib/rtx/cli-provisioning", () => ({
  resolveSignalsRtxWorkspaceSlug: vi.fn(async () => "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f"),
}));

describe("enqueueSnowballCalendarSeeds", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("posts calendar events with snowball metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { uuid: "evt-1" } }),
    });

    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const result = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/1", platform: "x" }],
      scoutConfig,
      {
        RTX_API_BASE_URL: "http://127.0.0.1:3101",
        SIGNALS_RTX_WORKSPACE_SLUG: "signals",
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.queued).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(init?.method)).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.metadata.workflowRunConfig.seedValue).toBe("https://x.com/acme/status/1");
    expect(body.metadata.dispatchStatus).toBe("scheduled");
    expect(body.title).toBe("[Signals] Snowball: x.com/acme/status");
    expect(body.description).toContain("https://x.com/acme/status/1");
    expect(body.metadata.agentHandlers[0].workspace).toBe(
      "f3a8c2e1-4d5b-4a7c-8e9f-0a1b2c3d4e5f",
    );
    expect(body.metadata.agentHandlers[0].prompt).toContain("https://x.com/acme/status/1");
  });

  it("reports rejected seeds as failures rather than silent skips", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event: { uuid: "evt-1" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "calendar unavailable" }),
      });

    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const result = await enqueueSnowballCalendarSeeds(
      [
        { url: "https://x.com/acme/status/1", platform: "x" },
        { url: "https://x.com/acme/status/2", platform: "x" },
      ],
      scoutConfig,
      {
        RTX_API_BASE_URL: "http://127.0.0.1:3101",
        SIGNALS_RTX_WORKSPACE_SLUG: "signals",
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.queued).toHaveLength(1);
    // A dropped seed is never retried, so it must not be reported as a clean skip.
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.url).toBe("https://x.com/acme/status/2");
    expect(result.failed[0]?.reason).toContain("calendar unavailable");
  });

  it("records a network error against the seed that triggered it", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const result = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/1", platform: "x" }],
      scoutConfig,
      {
        RTX_API_BASE_URL: "http://127.0.0.1:3101",
        SIGNALS_RTX_WORKSPACE_SLUG: "signals",
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.queued).toHaveLength(0);
    expect(result.failed).toEqual([
      { url: "https://x.com/acme/status/1", reason: "ECONNREFUSED" },
    ]);
  });

  it("does not re-queue a seed already queued in a previous run", async () => {
    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const env = {
      RTX_API_BASE_URL: "http://127.0.0.1:3101",
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };
    const okFetch = () =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ event: { uuid: "evt-1" } }),
      });

    const first = okFetch();
    await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/99", platform: "x" }],
      scoutConfig,
      env,
      first as unknown as typeof fetch,
    );
    expect(first).toHaveBeenCalledTimes(1);

    // A popular post stays in the feed, so the next heartbeat tick harvests it
    // again. It must not reach the calendar a second time.
    const second = okFetch();
    const result = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/99", platform: "x" }],
      scoutConfig,
      env,
      second as unknown as typeof fetch,
    );

    expect(second).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.queued).toHaveLength(0);
    expect(result.deduped).toEqual(["https://x.com/acme/status/99"]);
    expect(result.failed).toHaveLength(0);
  });

  it("collapses a url harvested twice within one batch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { uuid: "evt-1" } }),
    });

    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const result = await enqueueSnowballCalendarSeeds(
      [
        { url: "https://x.com/acme/status/7", platform: "x" },
        { url: "https://x.com/acme/status/7", platform: "x" },
      ],
      scoutConfig,
      {
        RTX_API_BASE_URL: "http://127.0.0.1:3101",
        SIGNALS_RTX_WORKSPACE_SLUG: "signals",
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.queued).toHaveLength(1);
    expect(result.deduped).toHaveLength(1);
  });

  it("does not record a seed the calendar rejected", async () => {
    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const env = {
      RTX_API_BASE_URL: "http://127.0.0.1:3101",
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };

    const failing = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "calendar unavailable" }),
    });
    await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/500", platform: "x" }],
      scoutConfig,
      env,
      failing as unknown as typeof fetch,
    );

    // A failed enqueue must stay retryable on the next tick.
    const retry = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { uuid: "evt-2" } }),
    });
    const result = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/500", platform: "x" }],
      scoutConfig,
      env,
      retry as unknown as typeof fetch,
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.queued).toHaveLength(1);
  });

  it("keeps the claim when a calendar timeout leaves the outcome unknown", async () => {
    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const env = {
      RTX_API_BASE_URL: "http://127.0.0.1:3101",
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };

    const timeoutError = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const timingOut = vi.fn().mockRejectedValue(timeoutError);
    const first = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/timeout", platform: "x" }],
      scoutConfig,
      env,
      timingOut as unknown as typeof fetch,
    );

    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0]?.reason).toContain("outcome unknown");

    // The calendar may have committed the event, so an immediate retry would
    // risk a duplicate. The claim stays until it expires.
    const retry = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { uuid: "evt-dup" } }),
    });
    const second = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/timeout", platform: "x" }],
      scoutConfig,
      env,
      retry as unknown as typeof fetch,
    );

    expect(retry).not.toHaveBeenCalled();
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.deduped).toEqual(["https://x.com/acme/status/timeout"]);
  });

  it("releases the claim when the calendar definitively rejects", async () => {
    const scoutConfig = readSnowballSeedScoutConfig(buildSnowballSeedScoutTemplateConfig());
    const env = {
      RTX_API_BASE_URL: "http://127.0.0.1:3101",
      SIGNALS_RTX_WORKSPACE_SLUG: "signals",
    };

    // A response means the server decided; nothing was committed, so retry now.
    const rejecting = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad request" }),
    });
    await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/reject", platform: "x" }],
      scoutConfig,
      env,
      rejecting as unknown as typeof fetch,
    );

    const retry = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { uuid: "evt-ok" } }),
    });
    const second = await enqueueSnowballCalendarSeeds(
      [{ url: "https://x.com/acme/status/reject", platform: "x" }],
      scoutConfig,
      env,
      retry as unknown as typeof fetch,
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.queued).toHaveLength(1);
  });

  it("does not truncate long facebook pfbid urls in the calendar title", () => {
    const longUrl =
      "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJmuy8cS3cvm8iWRUyLyyuxg5MzDSt5NwNpLY6xpvrl";
    expect(formatSnowballCalendarTitle(longUrl)).toBe(
      "[Signals] Snowball: facebook.com/saritasym/posts",
    );
  });
});
