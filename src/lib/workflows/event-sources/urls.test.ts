import { describe, expect, it } from "vitest";
import {
  canonicalizeLumaUrl,
  isSupportedLumaUrl,
  lumaEventKey,
  sanitizeExternalUrl,
} from "@/lib/workflows/event-sources/urls";

describe("Luma event URL policy", () => {
  it("drops every query value and fragment from supported Luma URLs", () => {
    expect(canonicalizeLumaUrl("https://www.luma.com/EventCase/?tk=secret&utm_source=x#guests"))
      .toBe("https://luma.com/EventCase");
    expect(canonicalizeLumaUrl("https://lu.ma/demo?invite=secret"))
      .toBe("https://lu.ma/demo");
  });

  it("uses the canonical URL as the initial source key instead of guessing an id from the slug", () => {
    expect(lumaEventKey("https://www.luma.com/EventCase/details?tk=secret"))
      .toBe("https://luma.com/EventCase/details");
  });

  it("rejects non-HTTPS, credentials, ports, and lookalike hosts", () => {
    expect(isSupportedLumaUrl("http://luma.com/event")).toBe(false);
    expect(isSupportedLumaUrl("https://user:pass@luma.com/event")).toBe(false);
    expect(isSupportedLumaUrl("https://luma.com:8443/event")).toBe(false);
    expect(isSupportedLumaUrl("https://luma.com.evil.test/event")).toBe(false);
  });

  it("preserves functional parameters elsewhere while recursively stripping secrets", () => {
    const sanitized = new URL(sanitizeExternalUrl(
      "https://example.com/post?page=2&token=outer&redirect=https%253A%252F%252Fother.test%252Fgo%253Ftk%253Dinner%2526ref%253Dok#fragment",
    ));
    expect(sanitized.searchParams.get("page")).toBe("2");
    expect(sanitized.searchParams.has("token")).toBe(false);
    const nested = new URL(sanitized.searchParams.get("redirect")!);
    expect(nested.searchParams.get("ref")).toBe("ok");
    expect(nested.searchParams.has("tk")).toBe(false);
    expect(sanitized.hash).toBe("");
  });
});
