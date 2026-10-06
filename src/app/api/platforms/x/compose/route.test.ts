import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/platforms/x/compose/route";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { getContentItem } from "@/lib/db/queries/content";
import { resetCoreTables } from "@/test/db";

describe("POST /api/platforms/x/compose", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  it("saves a draft without an OAuth X account (P6a browser publish path)", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/compose", {
        method: "POST",
        body: JSON.stringify({
          tweets: ["P6a browser publish draft"],
          saveAsDraft: true,
        }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.draft).toBe(true);
    expect(body.contentItemId).toBeTruthy();
    expect(body.items?.[0]?.id).toBe(body.contentItemId);

    const item = getContentItem(body.contentItemId);
    expect(item?.status).toBe("draft");
    expect(item?.platformTarget).toBe("x");
    expect(item?.platformAccountId).toBeNull();
  });

  it("still requires OAuth for API publish", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/compose", {
        method: "POST",
        body: JSON.stringify({
          tweets: ["API publish attempt"],
        }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("No X account connected");
  });
});

describe("POST /api/platforms/x/compose on a Dev instance (ADR-541-5)", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    vi.stubEnv("SIGNALS_INSTANCE", "dev");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses API publish with 403 DEV_INSTANCE_GUARD before any account lookup or X call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/compose", {
        method: "POST",
        body: JSON.stringify({ tweets: ["API publish attempt"] }),
      })
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "DEV_INSTANCE_GUARD",
      effect: "publish.x-api",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still saves drafts, which never leave Signals", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/platforms/x/compose", {
        method: "POST",
        body: JSON.stringify({ tweets: ["Dev draft"], saveAsDraft: true }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getContentItem(body.contentItemId)?.status).toBe("draft");
  });
});
