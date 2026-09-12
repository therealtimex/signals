import { describe, expect, it } from "vitest";
import { resolveSnowballSourceUrl, sourceAccessPlan } from "@/lib/workflows/snowball-sources/url";

describe("resolveSnowballSourceUrl", () => {
  it.each([
    ["https://luma.com/build-night?tk=secret", "luma", "event", true],
    ["https://x.com/acme/status/123?ref=feed", "x", "post", false],
    ["https://twitter.com/acme", "x", "profile", false],
    ["https://www.linkedin.com/in/grace-hopper?trk=secret", "linkedin", "profile", false],
    ["https://linkedin.com/company/acme", "linkedin", "organization", false],
    ["https://facebook.com/events/123", "facebook", "event", false],
    ["https://facebook.com/acme/posts/123", "facebook", "post", false],
    ["https://metr.org/about", "generic", "unknown", false],
  ])("classifies %s", (url, provider, kind, signedInRead) => {
    expect(resolveSnowballSourceUrl(url)).toMatchObject({
      provider,
      kind,
      capabilities: { publicRead: true, signedInRead },
    });
  });

  it("uses exact provider hosts and removes every query value", () => {
    expect(resolveSnowballSourceUrl("https://x.com.evil.test/acme/status/1?unknown=do-not-leak"))
      .toMatchObject({
        provider: "generic",
        canonicalUrl: "https://x.com.evil.test/acme/status/1",
      });
  });

  it("retains only documented non-secret Facebook story identifiers", () => {
    expect(resolveSnowballSourceUrl(
      "https://www.facebook.com/story.php?story_fbid=456&id=123&utm_source=feed&token=secret",
    )).toMatchObject({
      provider: "facebook",
      kind: "post",
      canonicalUrl: "https://facebook.com/story.php?id=123&story_fbid=456",
    });
    expect(resolveSnowballSourceUrl("https://facebook.com/story.php?utm_source=feed"))
      .toMatchObject({ kind: "page", canonicalUrl: "https://facebook.com/story.php" });
  });

  it.each([
    "http://metr.org/about",
    "https://user:password@metr.org/about",
    "https://metr.org:8443/about",
    "not a url",
  ])("rejects unsafe URL shape %s", (url) => {
    expect(resolveSnowballSourceUrl(url)).toBeNull();
  });

  it("keeps unsupported signed-in access as a structured public-only outcome", () => {
    const source = resolveSnowballSourceUrl("https://linkedin.com/company/acme")!;
    expect(sourceAccessPlan(source, true)).toEqual({
      mode: "public_only",
      signedInRequested: true,
      signedInSupported: false,
      reason: "linkedin supports public-only source reading.",
    });
  });
});
