import { beforeEach, describe, expect, it } from "vitest";
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
