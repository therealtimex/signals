export interface SnowballSeedUrlFilterResult {
  accepted: string[];
  rejected: string[];
}

type SnowballPlatform = "x" | "linkedin" | "facebook";

const POST_PATTERNS: Record<SnowballPlatform, RegExp> = {
  x: /https?:\/\/(?:x|twitter)\.com\/[^/\s?#]+\/status\/\d+/i,
  linkedin:
    /https?:\/\/(?:(?:www\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s"'<>]+|lnkd\.in\/p\/[^\s"'<>/?#]+)/i,
  facebook:
    /https?:\/\/(?:www\.)?facebook\.com\/(?:[^/\s"'<>]+\/posts\/(?:pfbid)?[^\s"'<>/?#]+|photo\/?\?fbid=\d+|groups\/[^/\s"'<>]+\/permalink\/\d+)/i,
};

function isNavigationUrl(url: string, platform: SnowballPlatform): boolean {
  const lowered = url.trim().toLowerCase();
  if (platform === "x") {
    return (
      lowered.endsWith("x.com/home") ||
      lowered.includes("/x.com/home?") ||
      lowered.includes("x.com/search?") ||
      lowered.includes("twitter.com/search?")
    );
  }
  if (platform === "linkedin") {
    return (
      lowered.endsWith("linkedin.com/feed/") ||
      lowered.endsWith("linkedin.com/feed") ||
      lowered.includes("linkedin.com/search/")
    );
  }
  return (
    lowered.replace(/\/+$/, "").endsWith("facebook.com") ||
    lowered.includes("facebook.com/search/")
  );
}

function looksLikePostUrl(url: string, platform: SnowballPlatform): boolean {
  const pattern = POST_PATTERNS[platform];
  if (!pattern.test(url)) {
    return false;
  }
  if (platform === "facebook" && url.toLowerCase().includes("/posts/pfbid")) {
    const token = url.toLowerCase().split("/posts/", 2)[1] ?? "";
    if (token.length < 60) {
      return false;
    }
  }
  return true;
}

function inferPlatformFromUrl(url: string): SnowballPlatform | null {
  const lowered = url.trim().toLowerCase();
  if (lowered.includes("lnkd.in/") || lowered.includes("linkedin.com")) {
    return "linkedin";
  }
  if (lowered.includes("x.com") || lowered.includes("twitter.com")) {
    return "x";
  }
  if (lowered.includes("facebook.com")) {
    return "facebook";
  }
  return null;
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
  if (lowered.includes("x.com/home") || lowered.includes("twitter.com/home")) {
    return true;
  }
  if (lowered.includes("x.com/search?") || lowered.includes("twitter.com/search?")) {
    return true;
  }
  if (lowered.includes("linkedin.com/search/")) {
    return true;
  }
  if (
    lowered.includes("linkedin.com/feed") &&
    !lowered.includes("/posts/") &&
    !lowered.includes("/feed/update/")
  ) {
    return true;
  }
  return (
    lowered.replace(/\/+$/, "").endsWith("facebook.com") ||
    lowered.includes("facebook.com/search/")
  );
}

function isEnqueueableSeed(url: string, platform: SnowballPlatform): boolean {
  return looksLikePostUrl(url, platform) && !isNavigationUrl(url, platform);
}

function isEnqueueableSeedAny(url: string, platformHint?: string | null): boolean {
  if (isGlobalNonPostUrl(url)) {
    return false;
  }
  const platform = inferPlatformFromUrl(url) ?? platformHint?.trim();
  if (platform !== "x" && platform !== "linkedin" && platform !== "facebook") {
    return false;
  }
  return isEnqueueableSeed(url, platform);
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
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const candidate = String(raw).trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    if (isEnqueueableSeedAny(candidate, platformHint)) {
      seen.add(candidate);
      accepted.push(candidate);
    } else {
      rejected.push(candidate);
    }
  }

  return { accepted, rejected };
}
