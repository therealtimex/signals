export const X_ANON_SESSION_NAME = "signals-x-anon";

export const X_ANON_NAV_ORIGINS = [
  "https://x.com",
  "https://twitter.com",
  "https://mobile.x.com",
] as const;

export const X_ANON_ASSET_ORIGINS = [
  "https://pbs.twimg.com",
  "https://abs.twimg.com",
  "https://api.x.com",
] as const;

export const X_ANON_USER_AGENT = "curl/8.7.1";
export const X_ANON_NAV_TIMEOUT_MS = 20_000;
export const X_ANON_HTTP_TIMEOUT_MS = 15_000;
export const X_ANON_HTTP_MAX_BYTES = 3_000_000;
export const X_ANON_MAX_REDIRECTS = 3;
export const X_ANON_MIN_REQUEST_GAP_MS = 1_000;
export const X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3;
export const X_ANON_COOLDOWN_MS = 15 * 60 * 1000;

export function isAllowedXNavigationOrigin(rawUrl: string): boolean {
  try {
    return (X_ANON_NAV_ORIGINS as readonly string[]).includes(new URL(rawUrl).origin);
  } catch {
    return false;
  }
}

export function isAllowedXBrowserOrigin(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      isAllowedXNavigationOrigin(rawUrl) ||
      (X_ANON_ASSET_ORIGINS as readonly string[]).includes(new URL(rawUrl).origin) ||
      host.endsWith(".twimg.com")
    );
  } catch {
    return false;
  }
}
