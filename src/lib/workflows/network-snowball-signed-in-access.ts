import { isSupportedLumaUrl } from "@/lib/workflows/event-sources/urls";

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
    return "Signed-in access for this source is not supported yet. Public extraction still runs.";
  }
  if (isSupportedLumaUrl(seedValue)) {
    return `When available, include visible guests, attendees, and organizers on ${hostname}.`;
  }
  return `Signed-in access for ${hostname} is not supported yet. Public extraction still runs.`;
}
