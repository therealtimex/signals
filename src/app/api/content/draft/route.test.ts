import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/content/draft/route";
import { getContentItem } from "@/lib/db/queries/content";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import { resetCoreTables } from "@/test/db";

const platformCombinations = Array.from(
  { length: 2 ** PUBLISH_PLATFORM_TARGETS.length - 1 },
  (_, index) =>
    ({
      platforms: PUBLISH_PLATFORM_TARGETS.filter((_, platformIndex) =>
        Boolean((index + 1) & (1 << platformIndex)),
      ),
    }),
);

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

  it("allows Facebook-only drafts without a connected platform account", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: "Facebook only via agent lane",
          platforms: ["facebook"],
        }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    const item = getContentItem(data.contentItemId);
    expect(item?.platformTarget).toBe("facebook");
    expect(item?.platformAccountId).toBeNull();
  });

  it.each(PUBLISH_PLATFORM_TARGETS)("accepts the registered %s platform", async (platform) => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({ body: `${platform} draft`, platforms: [platform] }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(getContentItem(data.contentItemId)?.platformTarget).toBe(platform);
  });

  it.each(platformCombinations)(
    "preserves registered platform combination $platforms",
    async ({ platforms }) => {
      const res = await POST(
        new NextRequest("http://localhost/api/content/draft", {
          method: "POST",
          body: JSON.stringify({ body: "Combined draft", platforms }),
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(getContentItem(data.contentItemId)?.platformTarget).toBe(platforms.join(","));
    },
  );

  it("round-trips Facebook when updating a multi-platform draft", async () => {
    const createRes = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({ body: "Facebook draft", platforms: ["facebook"] }),
      }),
    );
    const created = await createRes.json();

    const updateRes = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({
          body: "Updated X and Facebook draft",
          platforms: ["x", "facebook"],
          draftId: created.contentItemId,
        }),
      }),
    );
    const updated = await updateRes.json();

    expect(updateRes.status).toBe(200);
    const item = getContentItem(updated.contentItemId);
    expect(item?.platformTarget).toBe("x,facebook");
    expect(item?.body).toBe("Updated X and Facebook draft");
  });

  it("rejects unsupported platforms with the accepted registry values", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({ body: "Unsupported draft", platforms: ["x", "tiktok"] }),
      }),
    );
    const data = await res.json();
    const message = data.details?.fieldErrors?.platforms?.[0] as string | undefined;

    expect(res.status).toBe(400);
    expect(data).toMatchObject({ success: false, error: "Invalid request" });
    expect(message).toContain("'tiktok'");
    for (const platform of PUBLISH_PLATFORM_TARGETS) {
      expect(message).toContain(`'${platform}'`);
    }
  });

  it("rejects platform identifiers with unsupported casing", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({ body: "Wrong case", platforms: ["Facebook"] }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it("requires at least one platform", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/content/draft", {
        method: "POST",
        body: JSON.stringify({ body: "No platform", platforms: [] }),
      }),
    );

    expect(res.status).toBe(400);
  });
});
