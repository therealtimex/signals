import { defaultTargetCapabilities } from "@/lib/platforms/target-identity";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { detectPlatformHandle } from "@/lib/platforms/browser-connection";
import { verifyDetectedTarget } from "@/lib/platforms/target-adapters/shared";
import type { PlatformTargetAdapter } from "@/lib/platforms/target-adapters/types";

export const linkedinTargetAdapter: PlatformTargetAdapter = {
  async discover(page) {
    const handle = await detectPlatformHandle("linkedin", page, page.url());
    if (!handle) return [];
    return [
      {
        platform: "linkedin",
        kind: "profile",
        name: handle,
        handle,
        canonicalUrl: `https://www.linkedin.com${handle}`,
        capabilities: defaultTargetCapabilities("linkedin"),
      },
    ];
  },

  async verify(page, target) {
    return verifyDetectedTarget("linkedin", page, target);
  },

  async activate(page, target) {
    const verification = await verifyDetectedTarget("linkedin", page, target);
    if (verification.active) return { ...verification, switched: false };
    throw new PlatformTargetError(
      "TARGET_ACTIVATION_UNSUPPORTED",
      "LinkedIn account switching is not supported in a shared browser session; use a dedicated connection or sign in manually",
      { targetId: target.id }
    );
  },
};
