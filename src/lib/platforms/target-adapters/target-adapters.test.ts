import { beforeEach, describe, expect, it, vi } from "vitest";

const browserConnectionMocks = vi.hoisted(() => ({
  probePlatformLogin: vi.fn(),
  detectPlatformHandle: vi.fn(),
}));

vi.mock("@/lib/platforms/browser-connection", () => ({
  probePlatformLogin: browserConnectionMocks.probePlatformLogin,
  detectPlatformHandle: browserConnectionMocks.detectPlatformHandle,
}));

import type { Page } from "playwright";
import type { PlatformTarget } from "@/lib/db/types";
import { xTargetAdapter } from "@/lib/platforms/target-adapters/x";
import { linkedinTargetAdapter } from "@/lib/platforms/target-adapters/linkedin";
import { facebookTargetAdapter } from "@/lib/platforms/target-adapters/facebook";

function target(
  platform: "x" | "linkedin" | "facebook",
  handle: string,
  handleNormalized: string
): PlatformTarget {
  return {
    id: `target-${platform}`,
    connectionId: "connection",
    platform,
    kind: platform === "x" ? "account" : "profile",
    externalId: null,
    name: handle,
    handle,
    handleNormalized,
    canonicalUrl: null,
    authPrincipalTargetId: null,
    platformAccountId: null,
    capabilities: '["browse"]',
    isDefault: true,
    status: "active",
    mergedIntoTargetId: null,
    lastVerifiedAt: null,
    metadata: "{}",
    createdAt: 1,
    updatedAt: 1,
  };
}

const page = { url: () => "https://example.test" } as unknown as Page;

describe("platform target adapters", () => {
  beforeEach(() => {
    browserConnectionMocks.probePlatformLogin.mockReset().mockResolvedValue(true);
    browserConnectionMocks.detectPlatformHandle
      .mockReset()
      .mockImplementation(async (platform: string) =>
        platform === "x" ? "@current" : platform === "linkedin" ? "/in/current" : "current"
      );
  });

  it("verifies the already-active X and Facebook identities without switching", async () => {
    await expect(xTargetAdapter.activate(page, target("x", "@Current", "current"))).resolves.toMatchObject({
      active: true,
      switched: false,
    });
    await expect(
      facebookTargetAdapter.activate(page, target("facebook", "Current", "current"))
    ).resolves.toMatchObject({ active: true, switched: false });
  });

  it("keeps LinkedIn shared sessions verify-only", async () => {
    await expect(
      linkedinTargetAdapter.activate(page, target("linkedin", "/in/other", "other"))
    ).rejects.toMatchObject({ code: "TARGET_ACTIVATION_UNSUPPORTED" });
  });

  it("reports a signed-out LinkedIn session instead of a switching error", async () => {
    browserConnectionMocks.probePlatformLogin.mockResolvedValue(false);
    browserConnectionMocks.detectPlatformHandle.mockResolvedValue(null);

    await expect(
      linkedinTargetAdapter.activate(page, target("linkedin", "/in/current", "current")),
    ).resolves.toMatchObject({ loggedIn: false, active: false, switched: false });
  });

  it("does not discover Facebook targets from a logged-out page", async () => {
    browserConnectionMocks.probePlatformLogin.mockResolvedValue(false);

    await expect(facebookTargetAdapter.discover(page)).resolves.toEqual([]);
    expect(browserConnectionMocks.detectPlatformHandle).not.toHaveBeenCalled();
  });

  it("discovers Facebook identities only from entity links in the account menu", async () => {
    const links = [
      { name: "Managed Page", href: "https://www.facebook.com/managed.page" },
      { name: "Profile", href: "https://www.facebook.com/profile.php?id=12345" },
      { name: "Marketplace", href: "https://www.facebook.com/marketplace" },
      { name: "Recovery", href: "https://www.facebook.com/recover" },
      { name: "Someone's post", href: "https://www.facebook.com/someone/posts/999" },
    ];
    const anchorLocator = { evaluateAll: vi.fn().mockResolvedValue(links) };
    const menu = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue(anchorLocator),
    };
    const menus = { last: vi.fn().mockReturnValue(menu) };
    const accountButton = {
      first: vi.fn().mockReturnThis(),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const discoveryPage = {
      url: () => "https://www.facebook.com/",
      locator: vi.fn((selector: string) =>
        selector.includes("aria-label") ? accountButton : menus
      ),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    await expect(facebookTargetAdapter.discover(discoveryPage)).resolves.toEqual([
      expect.objectContaining({ kind: "profile", handle: "current" }),
      expect.objectContaining({ kind: "page", name: "Managed Page", handle: "managed.page" }),
      expect.objectContaining({ kind: "page", name: "Profile", handle: "id:12345" }),
    ]);
    expect(menu.locator).toHaveBeenCalledWith('a[href*="facebook.com/"]');
  });
});
