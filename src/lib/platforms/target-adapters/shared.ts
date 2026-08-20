import type { Page } from "playwright";
import type { PlatformTarget } from "@/lib/db/types";
import {
  detectPlatformHandle,
  probePlatformLogin,
} from "@/lib/platforms/browser-connection";
import {
  normalizePlatformTargetIdentity,
  type PlatformTargetPlatform,
} from "@/lib/platforms/target-identity";
import type { PlatformTargetVerification } from "@/lib/platforms/target-adapters/types";

const VERIFY_TIMEOUT_MS = 8_000;

export function identityMatchesDetectedHandle(
  target: PlatformTarget,
  detectedHandle: string | null
): boolean {
  if (!detectedHandle) return false;
  const detected = normalizePlatformTargetIdentity(
    target.platform as PlatformTargetPlatform,
    detectedHandle
  );
  if (target.externalId && detected.externalId) {
    return target.externalId === detected.externalId;
  }
  return !!target.handleNormalized && target.handleNormalized === detected.handleNormalized;
}

export async function verifyDetectedTarget(
  platform: PlatformTargetPlatform,
  page: Page,
  target: PlatformTarget
): Promise<PlatformTargetVerification> {
  const loggedIn = await probePlatformLogin(platform, page, VERIFY_TIMEOUT_MS);
  const detectedHandle = loggedIn
    ? await detectPlatformHandle(platform, page, page.url())
    : null;
  return {
    loggedIn,
    detectedHandle,
    active: loggedIn && identityMatchesDetectedHandle(target, detectedHandle),
  };
}

export function targetLabel(target: PlatformTarget): string {
  return target.handle?.trim() || target.name.trim();
}
