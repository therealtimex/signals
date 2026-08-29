import { describe, expect, it } from "vitest";
import { createContentItem } from "@/lib/db/queries/content";
import { createPublishJob } from "@/lib/db/queries/publish-jobs";
import { formatPublishCompletionThreadMessage } from "@/lib/rtx/publish-completion-thread";
import { resetCoreTables } from "@/test/db";

describe("formatPublishCompletionThreadMessage", () => {
  it("includes job status and per-platform results", () => {
    resetCoreTables();
    const item = createContentItem({
      body: "Hello world",
      title: "Launch post",
      contentType: "post",
      platformTarget: "x",
      status: "draft",
      origin: "authored",
      direction: "outbound",
      platformAccountId: null,
    });
    const job = createPublishJob({
      contentItemId: item.id,
      payload: {
        text: "Hello world",
        mediaAssetIds: [],
        platforms: ["x", "linkedin"],
        composedAt: 1,
      },
      platforms: ["x", "linkedin"],
    });

    const message = formatPublishCompletionThreadMessage(
      {
        ...job,
        status: "partial",
        targetsParsed: [
          {
            platform: "x",
            status: "published",
            handle: "@user",
            platformUrl: "https://x.com/user/status/1",
          },
          {
            platform: "linkedin",
            status: "failed",
            error: "captcha",
          },
        ],
      },
      item.title,
    );

    expect(message).toContain("**Publish — Done**");
    expect(message).toContain("Launch post");
    expect(message).toContain("**partial**");
    expect(message).toContain("**x**: published");
    expect(message).toContain("**linkedin**: failed");
  });
});
