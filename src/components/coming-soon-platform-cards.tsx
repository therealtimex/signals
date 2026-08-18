"use client";

import { PlatformConnectionCard } from "@/components/platform-connection-card";
import {
  getComingSoonPlatforms,
  PLATFORM_DISPLAY_NAMES,
} from "@/lib/platforms/capabilities";

/** Coming-soon platform cards for settings — oauth-disabled without browser connect. */
export function ComingSoonPlatformCards() {
  return getComingSoonPlatforms().map((platform) => (
    <PlatformConnectionCard
      key={platform}
      platform={platform}
      displayName={PLATFORM_DISPLAY_NAMES[platform] ?? platform}
      status="coming_soon"
    />
  ));
}
