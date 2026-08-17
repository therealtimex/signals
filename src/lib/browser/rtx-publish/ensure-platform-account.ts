import {
  createPlatformAccount,
  getPlatformAccountByPlatform,
  updatePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import type { PlatformAccount } from "@/lib/db/types";

const FALLBACK_DISPLAY_NAME = "X (RTX Browser)";

/**
 * Ensure an X platform_accounts row exists for browser publish.
 * Reuses OAuth or session row when present; otherwise creates auth_type session.
 */
export function ensureXPlatformAccount(detectedHandle?: string | null): PlatformAccount {
  const existing = getPlatformAccountByPlatform("x");
  const displayName = detectedHandle?.trim() || FALLBACK_DISPLAY_NAME;

  if (existing) {
    if (detectedHandle && existing.displayName !== displayName) {
      return updatePlatformAccount(existing.id, { displayName }) ?? existing;
    }
    return existing;
  }

  return createPlatformAccount({
    platform: "x",
    displayName,
    authType: "session",
    credentialsEncrypted: null,
    status: "active",
  });
}
