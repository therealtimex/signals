import {
  createPlatformAccount,
  getPlatformAccountByPlatform,
} from "@/lib/db/queries/platform-accounts";
import type { PlatformAccount } from "@/lib/db/types";
import type { Platform } from "@/lib/db/platforms";

const FALLBACK_DISPLAY_NAMES: Record<string, string> = {
  x: "X (RTX Browser)",
  linkedin: "LinkedIn (RTX Browser)",
  facebook: "Facebook (RTX Browser)",
};

/**
 * Ensure a platform_accounts row exists for browser/session publish.
 * Reuses OAuth or session row when present; otherwise creates auth_type session.
 */
export function ensureSessionPlatformAccount(
  platform: Platform,
  detectedHandle?: string | null
): PlatformAccount {
  const existing = getPlatformAccountByPlatform(platform);
  const fallback = FALLBACK_DISPLAY_NAMES[platform] ?? `${platform} (RTX Browser)`;
  const displayName = detectedHandle?.trim() || fallback;

  if (existing) return existing;

  return createPlatformAccount({
    platform,
    displayName,
    authType: "session",
    credentialsEncrypted: null,
    status: "active",
  });
}

/** Ensure an X platform_accounts row exists for browser publish. */
export function ensureXPlatformAccount(detectedHandle?: string | null): PlatformAccount {
  return ensureSessionPlatformAccount("x", detectedHandle);
}
