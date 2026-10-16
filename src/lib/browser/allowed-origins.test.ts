import { describe, expect, it } from "vitest";
import {
  classifyOrigin,
  dedupeOrigins,
  isOriginAllowed,
  normalizeAllowedOrigin,
  originsIncluded,
  sameOriginSet,
} from "@/lib/browser/allowed-origins";
import {
  buildDefaultAllowedOrigins,
  listDefaultAllowedOrigins,
} from "@/lib/platforms/platform-urls";

describe("normalizeAllowedOrigin", () => {
  it.each([
    ["https://lnkd.in/p/ggz83Nmd?x=1#f", "https://lnkd.in"],
    ["  https://www.example.com/path  ", "https://www.example.com"],
    ["HTTPS://WWW.LinkedIn.COM/feed", "https://www.linkedin.com"],
    ["https://X.com:443/", "https://x.com"],
    ["http://example.com:80/a", "http://example.com"],
    ["https://example.com:8443/a", "https://example.com:8443"],
    ["https://bücher.example/katalog", "https://xn--bcher-kva.example"],
    ["https://[::1]:3000/x", "https://[::1]:3000"],
  ])("keeps only the origin of %s", (input, origin) => {
    expect(normalizeAllowedOrigin(input)).toEqual({ ok: true, origin });
  });

  it.each([
    ["", "invalid_url"],
    ["   ", "invalid_url"],
    ["x.com", "invalid_url"],
    ["//x.com", "invalid_url"],
    ["www.example.com/path", "invalid_url"],
    ["https://", "invalid_url"],
    ["https://exa mple.com", "invalid_url"],
    ["*.linkedin.com", "invalid_url"],
    ["https://*.linkedin.com", "invalid_url"],
    ["not a url", "invalid_url"],
    ["ftp://files.example.com", "unsupported_scheme"],
    ["file:///etc/passwd", "unsupported_scheme"],
    ["javascript:alert(1)", "unsupported_scheme"],
    ["data:text/html,hi", "unsupported_scheme"],
    ["mailto:someone@example.com", "unsupported_scheme"],
    ["https://user:pass@example.com/", "credentials_not_allowed"],
    ["https://user@example.com/", "credentials_not_allowed"],
  ])("rejects %j as %s", (input, code) => {
    expect(normalizeAllowedOrigin(input)).toEqual({ ok: false, code });
  });

  it("rejects non-string input", () => {
    expect(normalizeAllowedOrigin(undefined)).toEqual({ ok: false, code: "invalid_url" });
    expect(normalizeAllowedOrigin(42)).toEqual({ ok: false, code: "invalid_url" });
  });
});

describe("origin set helpers", () => {
  it("dedupes equivalent origins and drops invalid ones, keeping first-seen order", () => {
    expect(
      dedupeOrigins([
        "https://lnkd.in/a",
        "https://x.com",
        "https://LNKD.in:443/b",
        "nonsense",
        "https://x.com/home",
      ]),
    ).toEqual(["https://lnkd.in", "https://x.com"]);
  });

  it("classifies an origin as default, custom or new", () => {
    const defaults = ["https://x.com"];
    const custom = ["https://example.org"];
    expect(classifyOrigin("https://x.com", defaults, custom)).toBe("default");
    expect(classifyOrigin("https://example.org", defaults, custom)).toBe("custom");
    expect(classifyOrigin("https://other.example", defaults, custom)).toBe("new");
  });

  it("allows a URL only when its exact origin is in the effective list", () => {
    const effective = ["https://lnkd.in", "https://www.linkedin.com"];
    expect(isOriginAllowed(effective, "https://lnkd.in/p/ggz83Nmd")).toBe(true);
    expect(isOriginAllowed(effective, "https://www.linkedin.com/posts/abc")).toBe(true);
    // Exact match only: no subdomain or apex widening.
    expect(isOriginAllowed(effective, "https://linkedin.com/feed")).toBe(false);
    expect(isOriginAllowed(effective, "https://evil.example/redirected")).toBe(false);
    expect(isOriginAllowed(effective, "not a url")).toBe(false);
  });

  it("compares origin lists after normalization", () => {
    expect(sameOriginSet(["https://x.com", "https://lnkd.in"], ["https://LNKD.in/", "https://x.com:443"])).toBe(true);
    expect(sameOriginSet(["https://x.com"], ["https://x.com", "https://lnkd.in"])).toBe(false);
    expect(originsIncluded(["https://x.com"], ["https://x.com", "https://lnkd.in"])).toBe(true);
    expect(originsIncluded(["https://example.org"], ["https://x.com"])).toBe(false);
  });
});

describe("default allowed origins", () => {
  it("lists the platform origins plus LinkedIn short links, each with its label", () => {
    expect(listDefaultAllowedOrigins()).toEqual([
      { origin: "https://x.com", label: "X" },
      { origin: "https://www.linkedin.com", label: "LinkedIn" },
      { origin: "https://lnkd.in", label: "LinkedIn short links" },
      { origin: "https://www.facebook.com", label: "Facebook" },
    ]);
  });

  it("stores defaults in normalized form, so they compare equal to what RealTimeX holds", () => {
    const defaults = buildDefaultAllowedOrigins();
    expect(dedupeOrigins(defaults)).toEqual(defaults);
  });
});
