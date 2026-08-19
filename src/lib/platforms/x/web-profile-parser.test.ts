import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCanonicalXProfileUrl, parseXWebProfile } from "@/lib/platforms/x/web-profile-parser";

function fixture(name: string): string {
  return readFileSync(new URL(`./web-fixtures/${name}`, import.meta.url), "utf8");
}

describe("parseCanonicalXProfileUrl", () => {
  it("accepts only canonical x.com profile paths", () => {
    expect(parseCanonicalXProfileUrl("https://x.com/tri_dao")).toEqual({ handle: "tri_dao" });
    expect(parseCanonicalXProfileUrl("https://x.com/tri_dao/")).toEqual({ handle: "tri_dao" });
    expect(parseCanonicalXProfileUrl("https://twitter.com/tri_dao")).toBeNull();
    expect(parseCanonicalXProfileUrl("https://x.com/i/user/568879807")).toBeNull();
    expect(parseCanonicalXProfileUrl("https://x.com/home")).toBeNull();
    expect(parseCanonicalXProfileUrl("https://x.com.evil.example/tri_dao")).toBeNull();
  });
});

describe("parseXWebProfile", () => {
  it("extracts and normalizes verifiable public metadata", () => {
    expect(parseXWebProfile(fixture("full-profile.html"))).toEqual({
      status: "ok",
      profile: {
        id: "568879807",
        handle: "tri_dao",
        name: "Tri Dao",
        description: "Making attention fast.",
        avatarUrl: "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
        canonicalUrl: "https://x.com/tri_dao",
        location: "Princeton, NJ",
        websiteUrl: "https://tridao.me/",
        createdAt: "2012-04-20T00:00:00.000Z",
        followersCount: 42000,
        followingCount: 800,
        tweetCount: 1200,
      },
    });
  });

  it("extracts the schema.org microdata shape served by anonymous curl", () => {
    expect(parseXWebProfile(fixture("microdata-profile.html"))).toEqual({
      status: "ok",
      profile: {
        id: "568879807",
        handle: "tri_dao",
        name: "Tri Dao",
        description: "Machine learning & systems.",
        avatarUrl: "https://pbs.twimg.com/profile_images/123/avatar_normal.jpg",
        canonicalUrl: "https://x.com/tri_dao",
        location: "Stanford, CA",
        websiteUrl: "https://tridao.me/",
        createdAt: "2012-05-02T07:13:50.000Z",
        followersCount: 43946,
        followingCount: 661,
      },
    });
  });

  it.each([
    ["logged-out-shell.html", "shell"],
    ["suspended.html", "suspended"],
    ["not-found.html", "not_found"],
  ])("classifies %s", (name, status) => {
    expect(parseXWebProfile(fixture(name)).status).toBe(status);
  });

  it("refuses OpenGraph-only metadata without a numeric identifier", () => {
    const html = '<link rel="canonical" href="https://x.com/person"><meta property="og:title" content="Person (@person) / X">';
    expect(parseXWebProfile(html)).toEqual({ status: "parse_failed", reason: "no_verifiable_identifier" });
  });

  it("drops avatars outside pbs.twimg.com and tolerates malformed JSON-LD", () => {
    const html = '<link rel="canonical" href="https://x.com/person"><meta property="og:image" content="https://evil.example/a.jpg"><script type="application/ld+json">not json</script><script type="application/ld+json">{"@type":"Person","identifier":"7","additionalName":"person"}</script>';
    expect(parseXWebProfile(html)).toMatchObject({
      status: "ok",
      profile: { id: "7", handle: "person", avatarUrl: undefined },
    });
  });
});
