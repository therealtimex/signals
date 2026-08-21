// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { IdentitiesSection } from "@/components/identities-section";
import { ExplorePlatformHandle } from "@/components/explore/explore-platform-handle";
import type { ContactIdentity } from "@/lib/db/types";

function identity(overrides: Partial<ContactIdentity>): ContactIdentity {
  return {
    id: "identity-1",
    contactId: "contact-1",
    platform: "x",
    platformUserId: "1275678667",
    platformHandle: "chickadeedee3",
    platformUrl: null,
    platformData: "{}",
    displayName: null,
    headline: null,
    bio: null,
    avatarUrl: null,
    location: null,
    websiteUrl: null,
    isVerified: null,
    followersCount: null,
    followingCount: null,
    postsCount: null,
    listedCount: null,
    platformCreatedAt: null,
    statsUpdatedAt: null,
    isPrimary: 1,
    isActive: 1,
    lastSyncedAt: null,
    syncErrors: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as ContactIdentity;
}

/**
 * These assert the *rendered surfaces* call the formatter. The formatter's own unit tests
 * cannot catch a JSX edit that goes back to `@${handle}` — which is exactly how the `@@`
 * bug shipped in the first place.
 */
describe("identity handle rendering", () => {
  it("renders one sigil in the identities section, whatever the row stores", () => {
    const html = renderToStaticMarkup(
      createElement(IdentitiesSection, {
        contactId: "contact-1",
        identities: [
          identity({ id: "bare", platformHandle: "chickadeedee3" }),
          identity({ id: "stored-sigil", platformUserId: "2", platformHandle: "@sama" }),
        ],
      }),
    );

    expect(html).toContain("@chickadeedee3");
    expect(html).toContain("@sama");
    expect(html).not.toContain("@@");
  });

  it("does not prefix a non-X handle in the identities section", () => {
    const html = renderToStaticMarkup(
      createElement(IdentitiesSection, {
        contactId: "contact-1",
        identities: [
          identity({
            platform: "gmail" as ContactIdentity["platform"],
            platformHandle: "someone@example.com",
          }),
        ],
      }),
    );

    expect(html).toContain("someone@example.com");
    expect(html).not.toContain("@someone@example.com");
  });

  it("renders one sigil on the explore surface, whatever the row stores", () => {
    const bare = renderToStaticMarkup(
      createElement(ExplorePlatformHandle, {
        platform: "x",
        handle: "chickadeedee3",
        platformUrl: null,
      }),
    );
    const stored = renderToStaticMarkup(
      createElement(ExplorePlatformHandle, {
        platform: "x",
        handle: "@chickadeedee3",
        platformUrl: null,
      }),
    );

    expect(bare).toContain("@chickadeedee3");
    expect(stored).toContain("@chickadeedee3");
    expect(bare).not.toContain("@@");
    expect(stored).not.toContain("@@");
  });

  it("does not prefix a non-X handle on the explore surface", () => {
    const html = renderToStaticMarkup(
      createElement(ExplorePlatformHandle, {
        platform: "linkedin",
        handle: "nguyen-k-phung-cfa",
        platformUrl: null,
      }),
    );

    expect(html).toContain("nguyen-k-phung-cfa");
    expect(html).not.toContain("@nguyen-k-phung-cfa");
  });
});
