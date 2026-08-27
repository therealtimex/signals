import { describe, expect, it } from "vitest";
import { filterSnowballEnqueueUrls } from "@/lib/rtx/snowball-seed-url-filter";

describe("filterSnowballEnqueueUrls", () => {
  it("rejects navigation and junk URLs before enqueue", () => {
    const { accepted, rejected } = filterSnowballEnqueueUrls(
      [
        "https://x.com/home",
        "https://x.com/search?q=yc+funding&f=live&src=typed_query",
        "https://www.facebook.com/saritasym/posts/pfbid0AVUoH55Pnb4cxmX8Gt5yjEYJm",
        "https://lnkd.in/p/g8t6zZDV",
        "https://x.com/acme/status/1234567890",
      ],
      "linkedin",
    );

    expect(accepted).toEqual([
      "https://lnkd.in/p/g8t6zZDV",
      "https://x.com/acme/status/1234567890",
    ]);
    expect(rejected).toHaveLength(3);
  });
});
