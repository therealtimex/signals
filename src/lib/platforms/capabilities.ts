import type { Platform } from "@/lib/db/platforms";

export interface PlatformCapabilities {
  /** Connect/disconnect via OAuth from settings. */
  oauth: boolean;
  /** Import contacts/connections into the CRM. */
  contactSync: boolean;
  /** Import the user's own posts/content items. */
  contentSync: boolean;
  /** Import engagement events/metrics (incl. message-metadata interactions). */
  engagementSync: boolean;
  /** Import profile/audience stats (incl. browser-scrape enrichment). */
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

/** Platforms registered in PLATFORM_CAPABILITIES with oauth disabled (coming soon). */
export function getPlatformsWithoutOAuth(): Platform[] {
  return (Object.entries(PLATFORM_CAPABILITIES) as [Platform, PlatformCapabilities][])
    .filter(([, caps]) => !caps.oauth)
    .map(([platform]) => platform);
}
