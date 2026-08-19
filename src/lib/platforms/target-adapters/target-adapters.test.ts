import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/browser-connection", () => ({
  probePlatformLogin: async () => true,
  detectPlatformHandle: async (platform: string) =>
    platform === "x" ? "@current" : platform === "linkedin" ? "/in/current" : "current",
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
});
