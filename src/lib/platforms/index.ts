import type { PlatformAdapter } from "@/lib/platforms/adapter";
import { NotImplementedError } from "@/lib/platforms/adapter";
import { isPlatform } from "@/lib/db/platforms";
import { InstagramPlatformAdapter } from "@/lib/platforms/instagram/adapter";
import { FacebookPlatformAdapter } from "@/lib/platforms/facebook/adapter";
import { ThreadsPlatformAdapter } from "@/lib/platforms/threads/adapter";
import { loadRealAdapter } from "@/lib/platforms/real-adapter-loader";

/** Factory function — returns the adapter for a given platform. */
export function getPlatformAdapter(platform: string): PlatformAdapter {
  if (!isPlatform(platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }

  switch (platform) {
    case "instagram":
      return new InstagramPlatformAdapter();
    case "facebook":
      return new FacebookPlatformAdapter();
    case "threads":
      return new ThreadsPlatformAdapter();
    case "x":
    case "linkedin":
    case "gmail":
      return loadRealAdapter(platform);
    default:
      throw new NotImplementedError(platform, "getPlatformAdapter");
  }
}
