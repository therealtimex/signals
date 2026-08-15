import type { PlatformAdapter } from "@/lib/platforms/adapter";
import { NotImplementedError } from "@/lib/platforms/adapter";
import { isPlatform } from "@/lib/db/platforms";
import { XPlatformAdapter } from "@/lib/platforms/x/adapter";
import { LinkedInPlatformAdapter } from "@/lib/platforms/linkedin/adapter";
import { GmailPlatformAdapter } from "@/lib/platforms/gmail/adapter";
import { InstagramPlatformAdapter } from "@/lib/platforms/instagram/adapter";
import { FacebookPlatformAdapter } from "@/lib/platforms/facebook/adapter";
import { ThreadsPlatformAdapter } from "@/lib/platforms/threads/adapter";

/** Factory function — returns the adapter for a given platform. */
export function getPlatformAdapter(platform: string): PlatformAdapter {
  if (!isPlatform(platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }

  switch (platform) {
    case "x":
      return new XPlatformAdapter();
    case "linkedin":
      return new LinkedInPlatformAdapter();
    case "gmail":
      return new GmailPlatformAdapter();
    case "instagram":
      return new InstagramPlatformAdapter();
    case "facebook":
      return new FacebookPlatformAdapter();
    case "threads":
      return new ThreadsPlatformAdapter();
    default:
      throw new NotImplementedError(platform, "getPlatformAdapter");
  }
}
