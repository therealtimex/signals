import { describe, expect, it } from "vitest";
import { normalizeOrgWebsiteUrl } from "@/lib/org-website";

describe("normalizeOrgWebsiteUrl", () => {
  it("returns null for empty input", () => {
    expect(normalizeOrgWebsiteUrl(null)).toBeNull();
    expect(normalizeOrgWebsiteUrl("   ")).toBeNull();
  });

  it("adds https scheme for bare domains", () => {
    expect(normalizeOrgWebsiteUrl("acme.com")).toBe("https://acme.com/");
    expect(normalizeOrgWebsiteUrl("www.acme.com")).toBe("https://www.acme.com/");
  });

  it("preserves explicit http(s) URLs", () => {
    expect(normalizeOrgWebsiteUrl("https://acme.com/about")).toBe("https://acme.com/about");
  });

  it("rejects invalid URLs", () => {
    expect(() => normalizeOrgWebsiteUrl("not a url")).toThrow("Invalid website URL");
  });
});
