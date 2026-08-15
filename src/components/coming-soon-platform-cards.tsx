"use client";

import { PlatformConnectionCard } from "@/components/platform-connection-card";
import {
  getPlatformsWithoutOAuth,
  PLATFORM_DISPLAY_NAMES,
} from "@/lib/platforms/capabilities";

/** Coming-soon platform cards for settings — oauth-disabled mapped adapters only. */
export function ComingSoonPlatformCards() {
  return getPlatformsWithoutOAuth().map((platform) => (
    <PlatformConnectionCard
      key={platform}
      platform={platform}
      displayName={PLATFORM_DISPLAY_NAMES[platform] ?? platform}
      status="coming_soon"
    />
  ));
}
