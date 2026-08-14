import { describe, expect, it } from "vitest";
import { liftIdentityStatsFromPlatformData } from "@/lib/db/identity-stats";
import { PLATFORMS, isPlatform } from "@/lib/db/platforms";

describe("platform registry", () => {
  it("includes legacy and v0.5 networks", () => {
    expect(PLATFORMS).toContain("x");
    expect(PLATFORMS).toContain("instagram");
    expect(PLATFORMS).toContain("bluesky");
  });

  it("validates platform strings", () => {
    expect(isPlatform("threads")).toBe(true);
    expect(isPlatform("invalid")).toBe(false);
  });
});

describe("liftIdentityStatsFromPlatformData", () => {
  it("lifts camelCase and snake_case keys from platform_data", () => {
    const lifted = liftIdentityStatsFromPlatformData(
      JSON.stringify({
        followers_count: 1200,
        following_count: 300,
        tweet_count: 42,
        listed_count: 5,
        verified: true,
        created_at: "2020-01-01T00:00:00.000Z",
      }),
    );

    expect(lifted.followersCount).toBe(1200);
    expect(lifted.followingCount).toBe(300);
    expect(lifted.postsCount).toBe(42);
    expect(lifted.listedCount).toBe(5);
    expect(lifted.isVerified).toBe(true);
    expect(lifted.platformCreatedAt).toBeGreaterThan(0);
    expect(lifted.statsUpdatedAt).toBeGreaterThan(0);
  });
});
