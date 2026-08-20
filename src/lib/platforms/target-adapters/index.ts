import type { PlatformTargetPlatform } from "@/lib/platforms/target-identity";
import type { PlatformTargetAdapter } from "@/lib/platforms/target-adapters/types";
import { facebookTargetAdapter } from "@/lib/platforms/target-adapters/facebook";
import { linkedinTargetAdapter } from "@/lib/platforms/target-adapters/linkedin";
import { xTargetAdapter } from "@/lib/platforms/target-adapters/x";

const ADAPTERS: Record<PlatformTargetPlatform, PlatformTargetAdapter> = {
  x: xTargetAdapter,
  linkedin: linkedinTargetAdapter,
  facebook: facebookTargetAdapter,
};

export function getPlatformTargetAdapter(
  platform: PlatformTargetPlatform
): PlatformTargetAdapter {
  return ADAPTERS[platform];
}

export type {
  DiscoveredPlatformTarget,
  PlatformTargetActivation,
  PlatformTargetAdapter,
  PlatformTargetVerification,
} from "@/lib/platforms/target-adapters/types";
