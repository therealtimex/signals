export const PLATFORM_TARGET_PLATFORMS = ["x", "linkedin", "facebook"] as const;
export type PlatformTargetPlatform = (typeof PLATFORM_TARGET_PLATFORMS)[number];

export const PLATFORM_TARGET_KINDS = ["account", "profile", "page", "organization"] as const;
export type PlatformTargetKind = (typeof PLATFORM_TARGET_KINDS)[number];

export type PlatformTargetCapability = "browse" | "publish";

export function isPlatformTargetPlatform(value: string): value is PlatformTargetPlatform {
  return (PLATFORM_TARGET_PLATFORMS as readonly string[]).includes(value);
}

export function isPlatformTargetKind(value: string): value is PlatformTargetKind {
  return (PLATFORM_TARGET_KINDS as readonly string[]).includes(value);
}

export function normalizePlatformTargetIdentity(
  platform: PlatformTargetPlatform,
  rawHandle: string | null | undefined
): { externalId: string | null; handle: string | null; handleNormalized: string | null } {
  const handle = rawHandle?.trim() || null;
  if (!handle) return { externalId: null, handle: null, handleNormalized: null };

  if (platform === "facebook" && /^id:\d+$/i.test(handle)) {
    return {
      externalId: handle.slice(handle.indexOf(":") + 1),
      handle: null,
      handleNormalized: null,
    };
  }

  const handleNormalized =
    platform === "x"
      ? handle.replace(/^@/, "").toLowerCase()
      : platform === "linkedin"
        ? handle.replace(/^\/?in\//i, "").replace(/^\//, "").toLowerCase()
        : handle.toLowerCase();

  return {
    externalId: null,
    handle,
    handleNormalized: handleNormalized || null,
  };
}

export function defaultTargetKind(platform: PlatformTargetPlatform): PlatformTargetKind {
  return platform === "x" ? "account" : "profile";
}

export function defaultTargetCapabilities(
  platform: PlatformTargetPlatform
): PlatformTargetCapability[] {
  void platform;
  return ["browse", "publish"];
}
