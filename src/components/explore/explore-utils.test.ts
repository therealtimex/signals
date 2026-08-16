import { describe, expect, it } from "vitest";
import type { ContactExploreIdentity } from "@/lib/db/queries/contact-explore";
import { selectPrimaryIdentity } from "@/components/explore/explore-utils";

function identity(
  id: string,
  overrides: Partial<ContactExploreIdentity> = {},
): ContactExploreIdentity {
  return {
    id,
    platform: "x",
    platformHandle: `@${id}`,
    displayName: id,
    followersCount: 100,
    followingCount: null,
    postsCount: null,
    listedCount: null,
    engagementRate: null,
    statsUpdatedAt: null,
    metricSnapshotAt: null,
    avatarUrl: null,
    bio: null,
    location: null,
    isVerified: null,
    platformCreatedAt: null,
    platformUrl: null,
    isPrimary: false,
    createdAt: 100,
    ...overrides,
  };
}

describe("selectPrimaryIdentity", () => {
  it("prefers isPrimary over higher followers", () => {
    const chosen = selectPrimaryIdentity([
      identity("late-high", { followersCount: 5000, createdAt: 200 }),
      identity("primary-low", { isPrimary: true, followersCount: 10, createdAt: 300 }),
    ]);
    expect(chosen?.id).toBe("primary-low");
  });

  it("uses earliest createdAt when followers are equal and no primary", () => {
    const chosen = selectPrimaryIdentity([
      identity("later", { followersCount: 100, createdAt: 200 }),
      identity("earlier", { followersCount: 100, createdAt: 100 }),
    ]);
    expect(chosen?.id).toBe("earlier");
  });
});
