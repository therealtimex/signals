/**
 * Social platform URL registry. Pure data so both the server (session guardrails) and the
 * Settings UI (labels for the always-allowed websites) read one source.
 */

export type SocialPlatform = "x" | "linkedin" | "facebook";

export type PlatformUrls = {
  label: string;
  setupUrl: string;
  homeUrl: string;
  host: string;
  /** Origins the platform needs besides its own pages, such as LinkedIn's short-link domain. */
  extraOrigins: { origin: string; label: string }[];
};

export const PLATFORM_URLS: Record<SocialPlatform, PlatformUrls> = {
  x: {
    label: "X",
    setupUrl: "https://x.com/login",
    homeUrl: "https://x.com/home",
    host: "x.com",
    extraOrigins: [],
  },
  linkedin: {
    label: "LinkedIn",
    setupUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/feed/",
    host: "linkedin.com",
    // Short links are supported workflow seeds; they redirect to www.linkedin.com (#547).
    extraOrigins: [{ origin: "https://lnkd.in", label: "LinkedIn short links" }],
  },
  facebook: {
    label: "Facebook",
    setupUrl: "https://www.facebook.com/login",
    homeUrl: "https://www.facebook.com/",
    host: "facebook.com",
    extraOrigins: [],
  },
};

export type DefaultAllowedOrigin = { origin: string; label: string };

/**
 * Websites every browser connection may open, with the label Settings shows for each.
 * Derived from PLATFORM_URLS so adding a platform extends the allowlist with no other edit
 * (ADR-547-3).
 */
export function listDefaultAllowedOrigins(): DefaultAllowedOrigin[] {
  const seen = new Set<string>();
  const entries: DefaultAllowedOrigin[] = [];
  const add = (origin: string, label: string) => {
    if (seen.has(origin)) return;
    seen.add(origin);
    entries.push({ origin, label });
  };
  for (const { label, setupUrl, homeUrl, extraOrigins } of Object.values(PLATFORM_URLS)) {
    add(new URL(setupUrl).origin, label);
    add(new URL(homeUrl).origin, label);
    for (const extra of extraOrigins) add(new URL(extra.origin).origin, extra.label);
  }
  return entries;
}

export function buildDefaultAllowedOrigins(): string[] {
  return listDefaultAllowedOrigins().map((entry) => entry.origin);
}
