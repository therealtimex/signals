import { describe, expect, it } from "vitest";
import {
  filterSnowballEnqueueUrls,
  isGlobalNonPostUrl,
} from "@/lib/rtx/snowball-seed-url-filter";

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

  it("rejects facebook search and home URLs but accepts post permalinks", () => {
    const { accepted, rejected } = filterSnowballEnqueueUrls(
      [
        "https://www.facebook.com/search/posts?q=funding+founder",
        "https://www.facebook.com/",
        "https://www.facebook.com/groups/acme/permalink/1234567890",
      ],
      "facebook",
    );

    expect(accepted).toEqual([
      "https://www.facebook.com/groups/acme/permalink/1234567890",
    ]);
    expect(rejected).toHaveLength(2);
  });

  it("classifies in-process without workspace scripts (standalone-safe)", () => {
    expect(isGlobalNonPostUrl("https://x.com/home")).toBe(true);
    const { accepted, rejected } = filterSnowballEnqueueUrls([
      "https://x.com/home",
      "https://x.com/acme/status/999",
    ]);
    expect(accepted).toEqual(["https://x.com/acme/status/999"]);
    expect(rejected).toEqual(["https://x.com/home"]);
  });

  it("rejects wrapper hosts and padded truncated pfbid query strings", () => {
    const { accepted, rejected } = filterSnowballEnqueueUrls([
      "https://evil.example/https://x.com/acme/status/123",
      `https://www.facebook.com/acme/posts/pfbid0SHORT?utm_source=${"x".repeat(100)}`,
    ]);

    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(2);
  });
});
