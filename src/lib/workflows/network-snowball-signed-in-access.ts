const EVENT_PROVIDER_HOSTS = new Set([
  "luma.com",
  "lu.ma",
]);
const PROFESSIONAL_NETWORK_HOSTS = new Set(["linkedin.com"]);

export function networkSnowballSourceHostname(seedValue: string): string | null {
  const raw = seedValue.trim();
  if (!raw) return null;
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // Try the scheme-prefixed form before falling back to generic copy.
    }
  }
  return null;
}

export function networkSnowballSignedInAccessDescription(seedValue: string): string {
  const hostname = networkSnowballSourceHostname(seedValue);
  if (!hostname) {
    return "Use this session's current signed-in state to read additional visible people and details on the source site.";
  }
  if (EVENT_PROVIDER_HOSTS.has(hostname)) {
    return `When available, include visible guests, attendees, and organizers on ${hostname}.`;
  }
  if (PROFESSIONAL_NETWORK_HOSTS.has(hostname)) {
    return `When available, include visible people and organizations on ${hostname}.`;
  }
  return `Use this session's current signed-in state to read additional visible people and details on ${hostname}.`;
}
