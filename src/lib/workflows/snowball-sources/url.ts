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

function kindFromPath(provider: SnowballSourceProvider, pathname: string): SnowballSourceKind {
  const segments = pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
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
    if (segments.includes("posts") || segments.includes("permalink") || segments.includes("story.php")) {
      return "post";
    }
    return segments.length ? "page" : "page";
  }
  return "unknown";
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
 * Canonicalize an untrusted source link. Source identity never includes query or fragment data;
 * that prevents invite/access tokens from reaching config, logs, storage, or an agent brief.
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
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  // Canonical source identity deliberately excludes every query, including unknown values.
  url.search = "";
  url.hash = "";
  url.hostname = normalizedHost(url);
  const provider = providerForHost(url.hostname);
  const kind = kindFromPath(provider, url.pathname);
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
  return {
    mode: signedInRequested && supported ? "public_and_signed_in" as const : "public_only" as const,
    signedInRequested,
    signedInSupported: supported,
    reason: signedInRequested && !supported
      ? `${source.provider === "generic" ? "This source" : source.provider} supports public-only source reading.`
      : null,
  };
}
