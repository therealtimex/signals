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

/**
 * X serves profile metadata only to a client it accepts as a real browser. A plain HTTP
 * client gets a shell with no `og:*` tags no matter which user agent it claims, and headless
 * Chrome is refused outright, so every anonymous read runs through a headed browser.
 *
 * These mirror `STEALTH_ARGS` in `@/lib/browser/session`. The anonymous path keeps its own
 * copy so it can never inherit the connected publish session's profile or arguments.
 */
export const X_ANON_BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
] as const;

/** Claimed by the local fallback browser only; the RTX session supplies its own. */
export const X_ANON_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const X_ANON_NAV_TIMEOUT_MS = 20_000;
export const X_ANON_MIN_REQUEST_GAP_MS = 1_000;
export const X_ANON_PARSE_FAILURE_BREAK_THRESHOLD = 3;
export const X_ANON_COOLDOWN_MS = 15 * 60 * 1000;
export const X_ANON_DEFERRED_REASON = "x_web_deferred" as const;

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
