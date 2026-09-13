import type {
  ResolvedSnowballSource,
  SnowballSourceKind,
  SnowballSourceProvider,
} from "@/lib/workflows/snowball-sources/types";

const PROVIDER_HOSTS: Record<Exclude<SnowballSourceProvider, "generic">, Set<string>> = {
  luma: new Set(["luma.com", "lu.ma"]),
  x: new Set(["x.com", "twitter.com"]),
  linkedin: new Set(["linkedin.com"]),
  facebook: new Set(["facebook.com", "fb.com"]),
};

const SECRET_QUERY_KEY = /(?:^|_)(?:access|auth|invite|session|secret|token|tk)(?:$|_)/i;

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function providerForHost(hostname: string): SnowballSourceProvider {
  for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
    if (hosts.has(hostname)) return provider as Exclude<SnowballSourceProvider, "generic">;
  }
  return "generic";
}

function kindFromUrl(provider: SnowballSourceProvider, url: URL): SnowballSourceKind {
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (provider === "luma") {
    return segments[0] === "calendar" || segments.includes("calendar") ? "calendar" : "event";
  }
  if (provider === "x") {
    return segments.includes("status") ? "post" : segments.length ? "profile" : "page";
  }
  if (provider === "linkedin") {
    if (segments[0] === "in") return "profile";
    if (segments[0] === "company" || segments[0] === "school") return "organization";
    if (segments.includes("posts") || segments.includes("feed") || segments.includes("feed-update")) {
      return "post";
    }
    return "page";
  }
  if (provider === "facebook") {
    if (segments[0] === "events") return "event";
    if (
      segments.includes("posts")
      || segments.includes("permalink")
      || (segments[0] === "story.php" && url.searchParams.has("story_fbid"))
    ) {
      return "post";
    }
    return segments.length ? "page" : "page";
  }
  return "unknown";
}

function retainFunctionalQuery(url: URL, provider: SnowballSourceProvider): void {
  const retained = new URLSearchParams();
  if (provider === "facebook" && url.pathname.toLowerCase() === "/story.php") {
    for (const key of ["id", "story_fbid"] as const) {
      const value = url.searchParams.get(key)?.trim();
      if (value && /^\d{1,30}$/.test(value)) retained.set(key, value);
    }
  }
  retained.sort();
  url.search = retained.toString();
}

function capabilities(provider: SnowballSourceProvider, kind: SnowballSourceKind) {
  const signedIn = provider === "luma" && kind === "event";
  return {
    publicRead: true,
    signedInRead: signedIn,
    participantExpansion: signedIn,
  };
}

/**
 * Canonicalize an untrusted source link. Only documented, non-secret identifiers that are
 * necessary to preserve source identity survive; credential-like and unknown query data does not.
 */
export function resolveSnowballSourceUrl(value: string): ResolvedSnowballSource | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !url.hostname
  ) return null;
  url.hash = "";
  url.hostname = normalizedHost(url);
  const provider = providerForHost(url.hostname);
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  retainFunctionalQuery(url, provider);
  const kind = kindFromUrl(provider, url);
  return {
    version: 1,
    canonicalUrl: url.toString().replace(/\/$/, url.pathname === "/" ? "/" : ""),
    provider,
    kind,
    classification: {
      basis: provider === "generic" ? "fallback" : "url",
      confidence: provider === "generic" ? "low" : "high",
    },
    capabilities: capabilities(provider, kind),
  };
}

/**
 * Validate a redirect target for transport without applying identity normalization. Redirects
 * commonly depend on the literal `www.` host or trailing slash, so those details must survive the
 * request boundary even though canonical source identities intentionally remove them.
 */
export function resolveSnowballSourceTransportUrl(value: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !url.hostname
  ) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function refineSnowballSource(
  source: ResolvedSnowballSource,
  kind: SnowballSourceKind,
  basis: ResolvedSnowballSource["classification"]["basis"] = "metadata",
  confidence: ResolvedSnowballSource["classification"]["confidence"] = "high",
): ResolvedSnowballSource {
  return {
    ...source,
    kind,
    classification: { basis, confidence },
    capabilities: capabilities(source.provider, kind),
  };
}

export function sourceAccessPlan(
  source: ResolvedSnowballSource,
  signedInRequested: boolean,
) {
  const supported = source.capabilities.signedInRead;
  const providerLabel = source.provider === "generic"
    ? "This source"
    : source.provider === "x"
      ? "X"
      : source.provider === "linkedin"
        ? "LinkedIn"
        : source.provider.charAt(0).toUpperCase() + source.provider.slice(1);
  return {
    mode: signedInRequested && supported ? "public_and_signed_in" as const : "public_only" as const,
    signedInRequested,
    signedInSupported: supported,
    reason: signedInRequested && !supported
      ? `${providerLabel} supports public-only source reading.`
      : null,
  };
}
