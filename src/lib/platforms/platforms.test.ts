import { describe, it, expect } from "vitest";
import { getPlatformAdapter } from "@/lib/platforms";
import { NotImplementedError } from "@/lib/platforms/adapter";
import { PLATFORM_CAPABILITIES, getPlatformsWithoutOAuth } from "@/lib/platforms/capabilities";
import { XPlatformAdapter } from "@/lib/platforms/x/adapter";
import { LinkedInPlatformAdapter } from "@/lib/platforms/linkedin/adapter";
import { GmailPlatformAdapter } from "@/lib/platforms/gmail/adapter";
import { InstagramPlatformAdapter } from "@/lib/platforms/instagram/adapter";
import { FacebookPlatformAdapter } from "@/lib/platforms/facebook/adapter";
import { ThreadsPlatformAdapter } from "@/lib/platforms/threads/adapter";

const STUB_PLATFORMS = ["instagram", "facebook", "threads"] as const;

describe("getPlatformAdapter", () => {
  it("returns stub adapters from the factory", () => {
    for (const platform of STUB_PLATFORMS) {
      const adapter = getPlatformAdapter(platform);
      expect(adapter.platform).toBe(platform);
    }
  });

  it("throws NotImplementedError when no adapter is registered", () => {
    expect(() => getPlatformAdapter("substack")).toThrow(NotImplementedError);
    try {
      getPlatformAdapter("substack");
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).platform).toBe("substack");
      expect((error as NotImplementedError).method).toBe("getPlatformAdapter");
    }
  });

  it("throws for an invalid platform string", () => {
    expect(() => getPlatformAdapter("not-a-platform")).toThrow(/Invalid platform/);
  });
});

describe("adapter capabilities", () => {
  it("uses the PLATFORM_CAPABILITIES map entry by reference", () => {
    const adapters = [
      new XPlatformAdapter(),
      new LinkedInPlatformAdapter(),
      new GmailPlatformAdapter(),
      new InstagramPlatformAdapter(),
      new FacebookPlatformAdapter(),
      new ThreadsPlatformAdapter(),
    ];

    for (const adapter of adapters) {
      expect(adapter.capabilities).toBe(PLATFORM_CAPABILITIES[adapter.platform]);
    }
  });
});

describe("stub platform adapters", () => {
  it("has all capabilities false", () => {
    for (const platform of STUB_PLATFORMS) {
      const caps = PLATFORM_CAPABILITIES[platform]!;
      expect(caps).toEqual({
        oauth: false,
        contactSync: false,
        contentSync: false,
        engagementSync: false,
        statsSync: false,
      });
    }
  });

  it.each(STUB_PLATFORMS)("throws NotImplementedError from every method (%s)", async (platform) => {
    const adapter = getPlatformAdapter(platform);

    await expect(adapter.getAuthorizationUrl("http://localhost/callback")).rejects.toMatchObject({
      name: "NotImplementedError",
      platform,
      method: "getAuthorizationUrl",
    });
    await expect(adapter.exchangeCode("code", "state", "http://localhost/callback")).rejects.toMatchObject({
      platform,
      method: "exchangeCode",
    });
    await expect(adapter.refreshToken("account")).rejects.toMatchObject({
      platform,
      method: "refreshToken",
    });
    await expect(adapter.revokeToken("account")).rejects.toMatchObject({
      platform,
      method: "revokeToken",
    });
    await expect(adapter.getProfile("account")).rejects.toMatchObject({
      platform,
      method: "getProfile",
    });
    await expect(adapter.getContacts("account")).rejects.toMatchObject({
      platform,
      method: "getContacts",
    });
    await expect(adapter.getUserById("account", "user")).rejects.toMatchObject({
      platform,
      method: "getUserById",
    });

    expect(() => adapter.getRateLimitState("account")).toThrow(
      expect.objectContaining({ name: "NotImplementedError", platform, method: "getRateLimitState" })
    );
  });
});

describe("getPlatformsWithoutOAuth", () => {
  it("lists exactly the stub platforms with oauth disabled", () => {
    expect(getPlatformsWithoutOAuth().sort()).toEqual(["facebook", "instagram", "threads"]);
  });
});
