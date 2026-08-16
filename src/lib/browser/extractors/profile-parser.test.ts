import { describe, expect, it } from "vitest";
import { parseProfile } from "@/lib/browser/extractors/profile-parser";
import type { RawProfileData } from "@/lib/browser/types";

function baseRaw(overrides: Partial<RawProfileData> = {}): RawProfileData {
  return {
    platform: "x",
    platformHandle: "janedoe",
    displayName: "Jane Doe",
    bio: "CTO @ AcmeAI | ex-@Meta | jane@acme.ai",
    location: "SF",
    website: "https://acme.ai",
    pinnedTweetText: null,
    recentTweetTexts: ["Shipping #AI products for founders"],
    followerCount: 1000,
    followingCount: 200,
    scrapedAt: 1_700_000_000,
    ...overrides,
  };
}

describe("parseProfile", () => {
  it("extracts title, company, email, and tags from bio", async () => {
    const parsed = await parseProfile(baseRaw());

    expect(parsed.title).toBe("CTO");
    expect(parsed.company).toBe("AcmeAI");
    expect(parsed.email).toBe("jane@acme.ai");
    expect(parsed.skills).toContain("AI");
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it("returns nulls when bio is empty", async () => {
    const parsed = await parseProfile(
      baseRaw({ bio: null, displayName: null, recentTweetTexts: [], website: null })
    );

    expect(parsed.company).toBeNull();
    expect(parsed.title).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.confidence).toBe(0);
  });
});
