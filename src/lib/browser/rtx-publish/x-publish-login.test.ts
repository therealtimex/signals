import { describe, expect, it } from "vitest";
import {
  handleFromProfileHref,
  isXLoginUrl,
} from "@/lib/browser/rtx-publish/x-publish-login";
import { scoreXContentPageUrl } from "@/lib/browser/rtx-publish/x-publish-url";

describe("x-publish login helpers", () => {
  it("parses desktop and mobile profile hrefs", () => {
    expect(handleFromProfileHref("/founder")).toBe("@founder");
    expect(handleFromProfileHref("/TrungLe")).toBe("@TrungLe");
    expect(handleFromProfileHref("/home")).toBeNull();
    expect(handleFromProfileHref("/i/flow/login")).toBeNull();
  });

  it("detects login URLs", () => {
    expect(isXLoginUrl("https://x.com/i/flow/login")).toBe(true);
    expect(isXLoginUrl("https://x.com/home")).toBe(false);
  });
});

describe("scoreXContentPageUrl", () => {
  it("prefers the home timeline tab", () => {
    expect(scoreXContentPageUrl("https://x.com/home")).toBeGreaterThan(
      scoreXContentPageUrl("https://x.com/explore")
    );
    expect(scoreXContentPageUrl("devtools://devtools/bundled/inspector.html")).toBe(-1);
  });
});
