import type { Platform } from "@/lib/db/platforms";
import type { PlatformAdapter } from "@/lib/platforms/adapter";

export type RealAdapterPlatform = Extract<Platform, "x" | "linkedin" | "gmail">;

export type RealAdapterLoader = (platform: RealAdapterPlatform) => PlatformAdapter;

let realAdapterLoader: RealAdapterLoader = defaultRealAdapterLoader;

/** Test seam — swap real-adapter loading without eager DB imports. */
export function setRealAdapterLoader(loader: RealAdapterLoader): void {
  realAdapterLoader = loader;
}

export function resetRealAdapterLoader(): void {
  realAdapterLoader = defaultRealAdapterLoader;
}

export function loadRealAdapter(platform: RealAdapterPlatform): PlatformAdapter {
  return realAdapterLoader(platform);
}

function defaultRealAdapterLoader(platform: RealAdapterPlatform): PlatformAdapter {
  switch (platform) {
    case "x": {
      const { XPlatformAdapter } = require("@/lib/platforms/x/adapter");
      return new XPlatformAdapter();
    }
    case "linkedin": {
      const { LinkedInPlatformAdapter } = require("@/lib/platforms/linkedin/adapter");
      return new LinkedInPlatformAdapter();
    }
    case "gmail": {
      const { GmailPlatformAdapter } = require("@/lib/platforms/gmail/adapter");
      return new GmailPlatformAdapter();
    }
  }
}
