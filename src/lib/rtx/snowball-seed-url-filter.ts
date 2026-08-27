export interface SnowballSeedUrlFilterResult {
  accepted: string[];
  rejected: string[];
}

type SnowballPlatform = "x" | "linkedin" | "facebook";

function normalizeHostname(hostname: string | null | undefined): string {
  if (!hostname) {
    return "";
  }
  return hostname.toLowerCase().replace(/^www\./, "");
}

function platformForHostname(hostname: string | null | undefined): SnowballPlatform | null {
  const host = normalizeHostname(hostname);
  if (host === "x.com" || host === "twitter.com") {
    return "x";
  }
  if (host === "linkedin.com" || host === "lnkd.in") {
    return "linkedin";
  }
  if (host === "facebook.com") {
    return "facebook";
  }
  return null;
}

function parseSupportedSocialUrl(
  url: string,
): { parsed: URL; platform: SnowballPlatform } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const platform = platformForHostname(parsed.hostname);
  if (!platform) {
    return null;
  }
  return { parsed, platform };
}

function looksLikePostUrl(url: string, platform: SnowballPlatform): boolean {
  const parsedBundle = parseSupportedSocialUrl(url);
  if (!parsedBundle || parsedBundle.platform !== platform) {
    return false;
  }

  const { parsed } = parsedBundle;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  if (platform === "x") {
    return /^\/[^/]+\/status\/\d+$/i.test(path);
  }
  if (platform === "linkedin") {
    if (normalizeHostname(parsed.hostname) === "lnkd.in") {
      return /^\/p\/[^/]+/i.test(path);
    }
    return /^\/posts\/[^/]+/i.test(path) || /^\/feed\/update\/[^/]+/i.test(path);
  }
  if (platform === "facebook") {
    if (path === "/photo") {
      const fbid = parsed.searchParams.get("fbid");
      return Boolean(fbid && /^\d+$/.test(fbid));
    }
    if (path.includes("/permalink/")) {
      return /\/permalink\/\d+$/i.test(path);
    }
    if (path.includes("/posts/")) {
      const token = path.split("/posts/").pop() ?? "";
      if (token.toLowerCase().startsWith("pfbid")) {
        return token.length >= 60;
      }
      return /^\d+$/.test(token);
    }
    return false;
  }
  return false;
}

function isNavigationUrl(url: string, platform: SnowballPlatform): boolean {
  const parsedBundle = parseSupportedSocialUrl(url);
  if (!parsedBundle || parsedBundle.platform !== platform) {
    return false;
  }

  const path = parsedBundle.parsed.pathname.replace(/\/+$/, "") || "/";
  if (platform === "x") {
    return path === "/" || path === "/home" || path.startsWith("/search");
  }
  if (platform === "linkedin") {
    return path === "/feed" || path.startsWith("/search");
  }
  return path === "/" || path.startsWith("/search");
}

function inferPlatformFromUrl(url: string): SnowballPlatform | null {
  return parseSupportedSocialUrl(url)?.platform ?? null;
}

/** Navigation/search/home URLs that must never become Snowball calendar seeds. */
export function isGlobalNonPostUrl(url: string): boolean {
  const lowered = url.trim().toLowerCase();
  if (!lowered.startsWith("http")) {
    return true;
  }
  // Broad on purpose: catches e2e/test junk in production queues.
  if (lowered.includes("/test/") || lowered.includes("e2e") || lowered.includes("1686-e2e")) {
    return true;
  }

  const parsedBundle = parseSupportedSocialUrl(url);
  if (!parsedBundle) {
    return true;
  }

  return isNavigationUrl(url, parsedBundle.platform);
}

function isEnqueueableSeed(url: string, platform: SnowballPlatform): boolean {
  return looksLikePostUrl(url, platform) && !isNavigationUrl(url, platform);
}

function isEnqueueableSeedAny(url: string): boolean {
  if (isGlobalNonPostUrl(url)) {
    return false;
  }
  const parsedBundle = parseSupportedSocialUrl(url);
  if (!parsedBundle) {
    return false;
  }
  return isEnqueueableSeed(url, parsedBundle.platform);
}

/**
 * Filter harvested URLs so navigation/search/home pages never reach the calendar
 * enqueue path. Pure TypeScript so standalone releases do not depend on python3
 * or workspace `scripts/`.
 */
export function filterSnowballEnqueueUrls(
  urls: string[],
  platformHint?: string | null,
): SnowballSeedUrlFilterResult {
  void platformHint;
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const candidate = String(raw).trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    if (isEnqueueableSeedAny(candidate)) {
      seen.add(candidate);
      accepted.push(candidate);
    } else {
      rejected.push(candidate);
    }
  }

  return { accepted, rejected };
}
