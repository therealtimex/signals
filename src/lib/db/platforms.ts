/** Canonical platform registry — widen existing enums here (§4 rule 4), validate open-text writes. */
export const PLATFORMS = [
  "x",
  "linkedin",
  "gmail",
  "substack",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
  "bluesky",
  "telegram",
  "whatsapp",
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Drizzle sqlite enum tuple derived from the registry. */
export const PLATFORM_ENUM = PLATFORMS as unknown as [Platform, ...Platform[]];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function assertPlatform(value: string): Platform {
  if (!isPlatform(value)) {
    throw new Error(`Invalid platform: ${value}`);
  }
  return value;
}
