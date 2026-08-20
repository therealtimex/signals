import type { Platform } from "@/lib/db/platforms";

export interface PlatformCapabilities {
  /** Connect/disconnect via OAuth from settings. */
  oauth: boolean;
  /** RTX browser session connect in Settings (no OAuth). */
  browserConnect?: boolean;
  /** Import contacts/connections into the CRM. */
  contactSync: boolean;
  /** Import the user's own posts/content items. */
  contentSync: boolean;
  /** Import engagement events/metrics (incl. message-metadata interactions). */
  engagementSync: boolean;
  /** Import profile/audience stats via RTX agent-browser (not in-process Playwright). */
  statsSync: boolean;
}

/** Static capability facts for platforms with a registered adapter. */
export const PLATFORM_CAPABILITIES: Partial<Record<Platform, PlatformCapabilities>> = {
  x: {
    oauth: true,
    contactSync: true,
    contentSync: true,
    engagementSync: true,
    statsSync: true,
  },
  linkedin: {
    oauth: true,
    contactSync: true,
    contentSync: false,
    engagementSync: false,
    statsSync: false,
  },
  gmail: {
    oauth: true,
    contactSync: true,
    contentSync: false,
    engagementSync: true,
    statsSync: false,
  },
  instagram: {
    oauth: false,
    contactSync: false,
    contentSync: false,
    engagementSync: false,
    statsSync: false,
  },
  facebook: {
    oauth: false,
    browserConnect: true,
    contactSync: false,
    contentSync: false,
    engagementSync: false,
    statsSync: false,
  },
  threads: {
    oauth: false,
    contactSync: false,
    contentSync: false,
    engagementSync: false,
    statsSync: false,
  },
};

/** Human-readable names for connect-UI cards. */
export const PLATFORM_DISPLAY_NAMES: Partial<Record<Platform, string>> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail / Google",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
};

/** Compact labels for dense product surfaces such as tables and status chips. */
export const PLATFORM_SHORT_LABELS: Partial<Record<Platform, string>> = {
  x: "X",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
};

/** Platforms registered in PLATFORM_CAPABILITIES with oauth disabled. */
export function getPlatformsWithoutOAuth(): Platform[] {
  return (Object.entries(PLATFORM_CAPABILITIES) as [Platform, PlatformCapabilities][])
    .filter(([, caps]) => !caps.oauth)
    .map(([platform]) => platform);
}

/** OAuth-disabled platforms still shown as coming soon (no browser connect yet). */
export function getComingSoonPlatforms(): Platform[] {
  return getPlatformsWithoutOAuth().filter(
    (platform) => !PLATFORM_CAPABILITIES[platform]?.browserConnect
  );
}
