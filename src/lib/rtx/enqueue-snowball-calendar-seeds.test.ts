import { describe, expect, it, vi } from "vitest";
import { enqueueSnowballCalendarSeeds } from "@/lib/rtx/enqueue-snowball-calendar-seeds";
import { readSnowballSeedScoutConfig } from "@/lib/workflows/snowball-seed-scout";
import { buildSnowballSeedScoutTemplateConfig } from "@/lib/workflows/snowball-seed-scout";

describe("enqueueSnowballCalendarSeeds", () => {
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
  });
});
