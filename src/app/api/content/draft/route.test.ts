import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/content/draft/route";
import { getContentItem } from "@/lib/db/queries/content";
import { resetCoreTables } from "@/test/db";

describe("POST /api/content/draft", () => {
  beforeEach(() => {
    resetCoreTables();
  });

  it("saves a long-form body without platform char limits", async () => {
    const longBody = "A".repeat(500);

    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: longBody,
          platforms: ["x"],
        }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.contentItemId).toBeTruthy();

    const item = getContentItem(data.contentItemId);
    expect(item?.body).toBe(longBody);
    expect(item?.platformTarget).toBe("x");
    expect(item?.platformAccountId).toBeNull();
  });

  it("persists multi-platform selection and round-trips on update", async () => {
    const createRes = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: "Cross-post draft",
          platforms: ["x", "linkedin"],
        }),
      })
    );
    const created = await createRes.json();
    expect(created.contentItemId).toBeTruthy();

    const updateRes = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: "Updated cross-post draft",
          platforms: ["x", "linkedin"],
          draftId: created.contentItemId,
        }),
      })
    );
    const updated = await updateRes.json();
    expect(updateRes.status).toBe(200);

    const item = getContentItem(updated.contentItemId);
    expect(item?.platformTarget).toBe("x,linkedin");
    expect(item?.body).toBe("Updated cross-post draft");
  });

  it("allows LinkedIn-only drafts without a connected platform account", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: "LinkedIn only via agent lane",
          platforms: ["linkedin"],
        }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    const item = getContentItem(data.contentItemId);
    expect(item?.platformTarget).toBe("linkedin");
    expect(item?.platformAccountId).toBeNull();
  });
});
