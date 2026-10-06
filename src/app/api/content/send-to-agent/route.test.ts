import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/content/send-to-agent/route";
import { db } from "@/lib/db/client";
import { publishJobs } from "@/lib/db/schema";
import { createContentItem, getContentItem } from "@/lib/db/queries/content";
import { resetCoreTables } from "@/test/db";

function request(body: unknown) {
  return new Request("http://127.0.0.1:3000/api/content/send-to-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/content/send-to-agent on a Dev instance (ADR-541-5)", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.stubEnv("RTX_APP_ID", "app-test");
    vi.stubEnv("RTX_API_BASE_URL", "http://127.0.0.1:3001");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers 403 DEV_INSTANCE_GUARD and writes no publish job", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const item = createContentItem({
      body: "Stored",
      contentType: "post",
      platformTarget: "x",
      status: "approved",
    });

    const response = await POST(request({ contentItemId: item.id, platforms: ["x"], text: "Hi" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect: "publish.dispatch",
      error: expect.stringContaining("SIGNALS_INSTANCE=dev"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.select().from(publishJobs).all()).toHaveLength(0);
    expect(getContentItem(item.id)?.status).toBe("approved");
  });

  it("still validates the request body first", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
    const response = await POST(request({ contentItemId: "x", platforms: [] }));
    expect(response.status).toBe(400);
  });
});
