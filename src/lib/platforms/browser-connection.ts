import { chromium, type Browser, type Page } from "playwright";
import {
  clearSession,
  hasSession,
  loadSession,
  setupSession,
  validateSession,
} from "@/lib/browser/session";
import type { BrowserPlatform } from "@/lib/browser/types";
import {
  getPlatformAccountByPlatform,
  updatePlatformAccount,
  deletePlatformAccount,
} from "@/lib/db/queries/platform-accounts";
import { decrypt } from "@/lib/auth/crypto";
import type { PlatformCredentials } from "@/lib/platforms/adapter";
import { getPlatformImportStats } from "@/lib/workflows/import-stats";
import { listSyncCursors } from "@/lib/db/queries/sync";
import { ensureSessionPlatformAccount } from "@/lib/publish/ensure-platform-account";
import {
  ensureBrowserConnection,
  listPlatformTargets,
  registerPlatformTarget,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";
import {
  defaultTargetCapabilities,
  defaultTargetKind,
  normalizePlatformTargetIdentity,
} from "@/lib/platforms/target-identity";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import {
  X_LOGGED_IN_MARKERS,
  X_PROFILE_HANDLE_SELECTORS,
  X_SELECTORS,
} from "@/lib/publish/x-browser/x-publish-selectors";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import {
  createRtxBrowserSession,
  findRtxBrowserSession,
  listRtxBrowserSessions,
  resolveRtxDebugPort,
  startRtxBrowserSession,
  type RtxBrowserSessionEntry,
  type RtxBrowserSessionGuardrails,
} from "@/lib/rtx/browser-sessions";

export type SocialPlatform = "x" | "linkedin" | "facebook";

export type PlatformSessionStatus = {
  mode: "rtx" | "legacy" | "none";
  hasSession: boolean;
  sessionRunning: boolean;
  lastValidatedAt: number | null;
  detectedHandle: string | null;
  sessionName: string;
};

const PLATFORM_URLS: Record<SocialPlatform, { setupUrl: string; homeUrl: string; host: string }> =
  {
    x: {
      setupUrl: "https://x.com/login",
      homeUrl: "https://x.com/home",
      host: "x.com",
    },
    linkedin: {
      setupUrl: "https://www.linkedin.com/login",
      homeUrl: "https://www.linkedin.com/feed/",
      host: "linkedin.com",
    },
    facebook: {
      setupUrl: "https://www.facebook.com/login",
      homeUrl: "https://www.facebook.com/",
      host: "facebook.com",
    },
  };

/**
 * Origins Signals asks RTX to open in the shared publish session. Derived from
 * PLATFORM_URLS so adding a platform extends the allowlist with no other edit.
 */
export function buildPublishSessionAllowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const { setupUrl, homeUrl } of Object.values(PLATFORM_URLS)) {
    origins.add(new URL(setupUrl).origin);
    origins.add(new URL(homeUrl).origin);
  }
  return [...origins];
}

/**
 * Guardrails for the shared publish session. RTX anchors every named session to
 * its first URL by default, which locks `signals-publish` to whichever platform
 * connected first and blocks tab opens for the others; unrestricted mode plus a
 * multi-origin allowlist keeps all platforms reachable without opening the
 * session up to arbitrary sites.
 */
export function buildPublishSessionGuardrails(): RtxBrowserSessionGuardrails {
  return {
    mode: "unrestricted",
    allowedOrigins: buildPublishSessionAllowedOrigins(),
    blockedOrigins: [],
  };
}

/**
 * Login markers, one selector per entry. A comma-joined union resolves through
 * `.first()` to the first match in DOM order, so a single hidden early match
 * (Facebook renders offscreen `div[role="navigation"]` blocks) hides every later
 * selector; probing them one at a time cannot be masked that way (#184).
 */
const LOGGED_IN_SELECTORS: Record<SocialPlatform, string[]> = {
  x: [...X_LOGGED_IN_MARKERS],
  linkedin: [
    ".global-nav__me",
    ".scaffold-layout",
    ".scaffold-layout__main",
    '[data-finite-scroll-hotkey-context="FEED"]',
    '[data-test-icon="nav-home-icon"]',
    'nav[aria-label="Primary"]',
  ],
  facebook: [
    '[aria-label="Your profile"]',
    '[aria-label="Account"]',
    '[data-pagelet="LeftRail"]',
    '[data-pagelet="ProfileTilesFeed_0"]',
    'div[role="navigation"]',
  ],
};

const LOGGED_OUT_SELECTORS: Record<SocialPlatform, string[]> = {
  x: ['[data-testid="loginButton"]'],
  linkedin: [".sign-in-form", "#username"],
  facebook: [
    "#loginform",
    '[data-testid="royal_login_form"]',
    'form[action*="login"]',
    "#email",
  ],
};

const LINKEDIN_AUTHENTICATED_NAV_SELECTORS = [
  ".global-nav__me",
  '[data-test-icon="nav-home-icon"]',
  'nav[aria-label="Primary"]',
] as const;

const LINKEDIN_SELF_PROFILE_LINK_SELECTORS = [
  '.global-nav__me a[href*="/in/"]',
  'button.global-nav__me a[href*="/in/"]',
  'a.global-nav__primary-link[href*="/in/"]',
] as const;

function asBrowserPlatform(platform: SocialPlatform): BrowserPlatform {
  return platform;
}

/** Match platform host exactly — avoid substring false positives (e.g. netflix.com ⊃ x.com). */
export function urlMatchesPlatformHost(rawUrl: string, host: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    const target = host.toLowerCase();
    return hostname === target || hostname.endsWith(`.${target}`);
  } catch {
    return false;
  }
}

const X_LOGIN_PATH_MARKERS = ["/login", "/i/flow/login", "/i/flow/signup"] as const;

/** True when an X tab URL indicates an authenticated session (not the login flow). */
export function isXLoggedInUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "x.com")) return false;
    if (isXLoggedOutUrl(rawUrl)) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    if (path.startsWith("/home") || path.startsWith("/compose")) return true;
    const segment = path.split("/").filter(Boolean)[0];
    if (!segment) return false;
    const reserved = new Set(["home", "explore", "search", "settings", "i", "intent", "share"]);
    return !reserved.has(segment);
  } catch {
    return false;
  }
}

/** True when an X tab URL indicates a logged-out or login-flow page. */
export function isXLoggedOutUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "x.com")) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    if (path === "/" || path === "") return true;
    return X_LOGIN_PATH_MARKERS.some((marker) => path.includes(marker));
  } catch {
    return false;
  }
}

/** True when a LinkedIn tab URL indicates an authenticated session. */
export function isLinkedInLoggedInUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "linkedin.com")) return false;
    if (isLinkedInLoggedOutUrl(rawUrl)) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    return (
      path.startsWith("/feed") ||
      path.startsWith("/mynetwork") ||
      path.startsWith("/notifications") ||
      path.startsWith("/messaging") ||
      path.startsWith("/jobs") ||
      path.startsWith("/company/") ||
      path.startsWith("/search")
    );
  } catch {
    return false;
  }
}

/** True when a LinkedIn tab URL indicates a logged-out or login-flow page. */
export function isLinkedInLoggedOutUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "linkedin.com")) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    return (
      path === "/" ||
      path.includes("/login") ||
      path.includes("/checkpoint") ||
      path.includes("/authwall")
    );
  } catch {
    return false;
  }
}

export function extractLinkedInVanityFromUrl(rawUrl: string): string | null {
  const match = rawUrl.match(/\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

export function formatLinkedInHandle(vanity: string): string {
  return `/in/${vanity}`;
}

const FACEBOOK_RESERVED_PATHS = new Set([
  "home",
  "login",
  "watch",
  "marketplace",
  "gaming",
  "groups",
  "events",
  "pages",
  "reels",
  "stories",
  "photo",
  "photos",
  "videos",
  "people",
  "search",
  "settings",
  "privacy",
  "help",
  "recover",
  "checkpoint",
  "share",
  "dialog",
  "friends",
  "messages",
  "notifications",
  "bookmarks",
  "saved",
  "ads",
  "business",
  "l.php",
  "hashtag",
  "me",
  "profile.php",
]);

const FACEBOOK_LOGGED_IN_PREFIXES = [
  "/home",
  "/friends",
  "/messages",
  "/notifications",
  "/bookmarks",
  "/saved",
  "/settings",
] as const;

/**
 * Extract a vanity profile slug from a Facebook URL.
 * Used for display-name detection only after logged-in selectors pass — public profile
 * URLs are viewable while logged out and must not imply connection (#147 lesson).
 */
export function extractFacebookProfileSlugFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, "https://www.facebook.com");
    if (!urlMatchesPlatformHost(url.href, "facebook.com")) return null;

    const path = url.pathname.toLowerCase();
    const profileIdMatch = path.match(/^\/profile\.php$/i);
    if (profileIdMatch && url.searchParams.get("id")) {
      return `id:${url.searchParams.get("id")}`;
    }

    const segment = path.split("/").filter(Boolean)[0];
    if (!segment || FACEBOOK_RESERVED_PATHS.has(segment)) return null;
    // `home.php`, `index.php`, … are app endpoints, never people. Without this,
    // the logged-in feed at /home.php reads as a public profile URL and suppresses
    // the logged-in verdict (#184).
    if (segment.endsWith(".php")) return null;
    if (/^[a-z0-9.]+$/i.test(segment)) return segment;
    return null;
  } catch {
    return null;
  }
}

export function formatFacebookHandle(slug: string): string {
  return slug;
}

/** True when a Facebook tab URL indicates an authenticated session. */
export function isFacebookLoggedInUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "facebook.com")) return false;
    if (isFacebookLoggedOutUrl(rawUrl)) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    // Public vanity profile URLs are viewable while logged out — never URL-positive alone.
    if (extractFacebookProfileSlugFromUrl(rawUrl)) return false;
    return FACEBOOK_LOGGED_IN_PREFIXES.some((prefix) => path.startsWith(prefix));
  } catch {
    return false;
  }
}

/** True when a Facebook tab URL indicates a logged-out or login-flow page. */
export function isFacebookLoggedOutUrl(rawUrl: string): boolean {
  try {
    if (!urlMatchesPlatformHost(rawUrl, "facebook.com")) return false;
    const path = new URL(rawUrl).pathname.toLowerCase();
    // Logged-in News Feed is served at `/` — treat root as neutral; DOM selectors decide.
    if (path === "/" || path === "") return false;
    return (
      path.includes("/login") ||
      path.includes("login.php") ||
      path.includes("/checkpoint") ||
      path.includes("/recover") ||
      path.includes("/authwall")
    );
  } catch {
    return false;
  }
}

function platformUrlChecks(
  platform: SocialPlatform,
  pageUrl: string
): { loggedOut: boolean; loggedIn: boolean } {
  switch (platform) {
    case "x":
      return { loggedOut: isXLoggedOutUrl(pageUrl), loggedIn: isXLoggedInUrl(pageUrl) };
    case "linkedin":
      return {
        loggedOut: isLinkedInLoggedOutUrl(pageUrl),
        loggedIn: isLinkedInLoggedInUrl(pageUrl),
      };
    case "facebook":
      return {
        loggedOut: isFacebookLoggedOutUrl(pageUrl),
        loggedIn: isFacebookLoggedInUrl(pageUrl),
      };
  }
}

/** Auth challenges are terminal evidence, unlike a login URL that may still redirect. */
function isPlatformAuthChallengeUrl(
  platform: SocialPlatform,
  rawUrl: string,
): boolean {
  try {
    const path = new URL(rawUrl).pathname.toLowerCase();
    if (platform === "linkedin") {
      return path.includes("/checkpoint") || path.includes("/authwall");
    }
    if (platform === "facebook") {
      return (
        path.includes("/checkpoint") ||
        path.includes("/recover") ||
        path.includes("/authwall")
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function extractXHandleFromProfileHref(href: string | null | undefined): string | null {
  if (!href?.startsWith("/") || href.includes("/status/")) return null;
  const segment = href.replace(/^\//, "").split("/")[0];
  if (!segment) return null;
  const reserved = new Set(["home", "explore", "search", "settings", "i", "compose", "intent"]);
  if (reserved.has(segment.toLowerCase())) return null;
  return segment.startsWith("@") ? segment : `@${segment}`;
}

function sessionValidationTimestamp(
  account: ReturnType<typeof getPlatformAccountByPlatform>
): number | null {
  if (account?.authType !== "session") return null;
  return account.lastSyncedAt ?? null;
}

function readOAuthScopes(account: ReturnType<typeof getPlatformAccountByPlatform>): {
  grantedScopes: string;
  syncCapable: boolean;
} {
  if (!account?.credentialsEncrypted) {
    return { grantedScopes: "", syncCapable: false };
  }

  try {
    const creds: PlatformCredentials = JSON.parse(decrypt(account.credentialsEncrypted));
    const grantedScopes =
      account.platform === "linkedin"
        ? (creds.grantedScopes ?? "").replace(/,/g, " ")
        : creds.grantedScopes ?? "";
    const syncCapable =
      account.platform === "x"
        ? grantedScopes.includes("follows.read")
        : grantedScopes.includes("r_connections");
    return { grantedScopes, syncCapable };
  } catch {
    return { grantedScopes: "", syncCapable: false };
  }
}

export function isSessionAccountConnected(
  account: ReturnType<typeof getPlatformAccountByPlatform>,
  sessionStatus: PlatformSessionStatus
): boolean {
  if (!sessionStatus.hasSession) return false;
  // Running alone does not mean logged in — require validate or an active session row.
  if (sessionStatus.lastValidatedAt) return true;
  return account?.authType === "session" && account.status === "active";
}

export function isOAuthConnected(
  account: ReturnType<typeof getPlatformAccountByPlatform>
): boolean {
  return !!account?.credentialsEncrypted;
}

export async function getPlatformSessionStatus(
  platform: SocialPlatform,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<PlatformSessionStatus> {
  const sessionName = RTX_PUBLISH_SESSION_NAME;

  if (isRtxEmbedded(env)) {
    try {
      const sessions = await listRtxBrowserSessions(env, fetchImpl);
      const entry = findRtxBrowserSession(sessions, sessionName);
      const account = getPlatformAccountByPlatform(platform);
      return {
        mode: "rtx",
        hasSession: !!entry,
        sessionRunning: !!entry?.running || entry?.runtime?.status === "running",
        lastValidatedAt: sessionValidationTimestamp(account),
        detectedHandle:
          account?.authType === "session" ? account.displayName ?? null : null,
        sessionName,
      };
    } catch {
      return {
        mode: "rtx",
        hasSession: false,
        sessionRunning: false,
        lastValidatedAt: null,
        detectedHandle: null,
        sessionName,
      };
    }
  }

  const legacy = loadSession(asBrowserPlatform(platform));
  return {
    mode: hasSession(asBrowserPlatform(platform)) ? "legacy" : "none",
    hasSession: hasSession(asBrowserPlatform(platform)),
    sessionRunning: false,
    lastValidatedAt: legacy?.lastValidatedAt ?? null,
    detectedHandle: getPlatformAccountByPlatform(platform)?.displayName ?? null,
    sessionName,
  };
}

const PLATFORM_TAB_WAIT_MS = 15_000;
const LOGIN_PROBE_TIMEOUT_MS = 10_000;
const PROBE_POLL_MS = 250;
/** A freshly opened tab may still be redirecting; do not trust a login URL yet. */
const PROBE_REDIRECT_GRACE_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when any one of the selectors is visible. */
async function isAnySelectorVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const visible = await page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
    if (visible) return true;
  }
  return false;
}

function findPlatformPage(browser: Browser, host: string): Page | null {
  for (const context of browser.contexts()) {
    for (const candidate of context.pages()) {
      if (urlMatchesPlatformHost(candidate.url(), host)) return candidate;
    }
  }
  return null;
}

async function waitForPlatformPage(
  browser: Browser,
  host: string,
  timeoutMs: number
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = findPlatformPage(browser, host);
    if (page) return page;
    if (Date.now() >= deadline) return null;
    await sleep(PROBE_POLL_MS);
  }
}

/**
 * Poll the page for login markers. `locator.isVisible()` returns immediately
 * rather than waiting, and a just-opened tab is usually still loading or
 * redirecting, so a single pass decides before the page can answer (#184).
 */
export async function probePlatformLogin(
  platform: SocialPlatform,
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  const deadline = start + timeoutMs;

  for (;;) {
    if (await isAnySelectorVisible(page, LOGGED_OUT_SELECTORS[platform])) return false;

    const { loggedIn, loggedOut } = platformUrlChecks(platform, page.url());
    if (loggedIn) return true;
    if (await isAnySelectorVisible(page, LOGGED_IN_SELECTORS[platform])) return true;
    if (loggedOut && Date.now() - start >= PROBE_REDIRECT_GRACE_MS) return false;
    if (Date.now() >= deadline) return false;

    await sleep(PROBE_POLL_MS);
  }
}

export type AuthenticatedPlatformIdentity = {
  loggedIn: boolean;
  detectedHandle: string | null;
};

/**
 * Poll for the account-owned identity required to bind work to the live session.
 * A platform URL can become visible before client-rendered account navigation,
 * so URL-positive login evidence alone is not a complete identity verdict.
 */
export async function probeAuthenticatedPlatformIdentity(
  platform: SocialPlatform,
  page: Page,
  timeoutMs: number,
): Promise<AuthenticatedPlatformIdentity> {
  const start = Date.now();
  const deadline = start + timeoutMs;

  for (;;) {
    if (await isAnySelectorVisible(page, LOGGED_OUT_SELECTORS[platform])) {
      return { loggedIn: false, detectedHandle: null };
    }

    const pageUrl = page.url();
    const { loggedIn, loggedOut } = platformUrlChecks(platform, pageUrl);
    if (loggedOut && isPlatformAuthChallengeUrl(platform, pageUrl)) {
      return { loggedIn: false, detectedHandle: null };
    }

    const loginSurfaceDetected =
      loggedIn || (await isAnySelectorVisible(page, LOGGED_IN_SELECTORS[platform]));
    if (loginSurfaceDetected) {
      const detectedHandle = await detectPlatformHandle(platform, page, pageUrl);
      if (detectedHandle) return { loggedIn: true, detectedHandle };
    }

    if (loggedOut && Date.now() - start >= PROBE_REDIRECT_GRACE_MS) {
      return { loggedIn: false, detectedHandle: null };
    }
    if (Date.now() >= deadline) {
      return { loggedIn: false, detectedHandle: null };
    }

    await sleep(PROBE_POLL_MS);
  }
}

async function detectLoggedInViaCdp(
  platform: SocialPlatform,
  debugPort: number,
  requestPlatformTab?: () => Promise<void>
): Promise<{ isLoggedIn: boolean; detectedHandle: string | null }> {
  const urls = PLATFORM_URLS[platform];
  let browser: Browser | null = null;

  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    let page = findPlatformPage(browser, urls.host);

    if (!page && requestPlatformTab) {
      // The RealTimeX Browser hosts its tabs itself, so a CDP client cannot open
      // one; the tab has to be requested through the RTX API and waited for.
      await requestPlatformTab();
      page = await waitForPlatformPage(browser, urls.host, PLATFORM_TAB_WAIT_MS);
    }

    if (!page) {
      // Standalone Chromium: no RTX to ask, so drive the page directly.
      const context = browser.contexts()[0] ?? (await browser.newContext());
      page = await context.newPage();
      await page.goto(urls.homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }

    const isLoggedIn = await probePlatformLogin(platform, page, LOGIN_PROBE_TIMEOUT_MS);
    const detectedHandle = isLoggedIn
      ? await detectPlatformHandle(platform, page, page.url())
      : null;

    return { isLoggedIn, detectedHandle };
  } catch {
    return { isLoggedIn: false, detectedHandle: null };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function detectPlatformHandle(
  platform: SocialPlatform,
  page: Page,
  pageUrl: string
): Promise<string | null> {
  if (platform === "x") {
    for (const selector of X_PROFILE_HANDLE_SELECTORS) {
      const href = await page
        .locator(selector)
        .first()
        .getAttribute("href")
        .catch(() => null);
      const handle = extractXHandleFromProfileHref(href);
      if (handle) return handle;
    }

    const label = await page
      .locator(X_SELECTORS.accountSwitcher)
      .getAttribute("aria-label")
      .then((value) => {
        const match = value?.match(/@(\w+)/);
        return match ? `@${match[1]}` : null;
      })
      .catch(() => null);
    return label;
  }

  if (platform === "facebook") {
    // v1: active personal account in the RTX session (not Page admin or public profile URLs).
    const navSelectors = [
      'a[aria-label="Your profile"]',
      'a[aria-label*="profile" i][href*="facebook.com"]',
      'div[role="navigation"] a[href*="facebook.com/me"]',
      'a[href*="/me/"]',
    ];

    for (const selector of navSelectors) {
      const href = await page
        .locator(selector)
        .first()
        .getAttribute("href")
        .catch(() => null);
      const slug = extractFacebookProfileSlugFromUrl(href ?? "");
      if (slug) return formatFacebookHandle(slug);
    }

    const pageSlug = extractFacebookProfileSlugFromUrl(pageUrl);
    return pageSlug ? formatFacebookHandle(pageSlug) : null;
  }

  const authenticatedNavigationVisible = await isAnySelectorVisible(
    page,
    [...LINKEDIN_AUTHENTICATED_NAV_SELECTORS],
  );
  if (!authenticatedNavigationVisible) return null;

  for (const selector of LINKEDIN_SELF_PROFILE_LINK_SELECTORS) {
    const href = await page
      .locator(selector)
      .first()
      .getAttribute("href")
      .catch(() => null);
    const vanity = extractLinkedInVanityFromUrl(href ?? "");
    if (vanity) return formatLinkedInHandle(vanity);
  }
  return null;
}

/**
 * Register the shared publish session with the current guardrails. Re-sent on
 * every connect so a session anchored by an earlier build self-heals in place —
 * RTX merges guardrails into the existing record, keeping the profile and its
 * logins. Deliberately no `url`: RTX would start the session and open a tab for
 * it, which is the caller's decision, not this step's.
 */
async function ensureRtxPublishSessionRegistered(
  env: EnvLike,
  fetchImpl: typeof fetch,
  sessionName = RTX_PUBLISH_SESSION_NAME
): Promise<void> {
  await createRtxBrowserSession(
    {
      sessionName,
      guardrails: buildPublishSessionGuardrails(),
    },
    env,
    fetchImpl
  );
}

/** Ensure the shared session is running, without opening or focusing a tab. */
export async function ensureRtxSessionRunning(
  env: EnvLike,
  fetchImpl: typeof fetch,
  sessionName = RTX_PUBLISH_SESSION_NAME
): Promise<RtxBrowserSessionEntry | undefined> {
  await ensureRtxPublishSessionRegistered(env, fetchImpl, sessionName);

  let entry = findRtxBrowserSession(
    await listRtxBrowserSessions(env, fetchImpl),
    sessionName
  );

  if (!entry?.running && entry?.runtime?.status !== "running") {
    await startRtxBrowserSession({ sessionName }, env, fetchImpl);
    entry = findRtxBrowserSession(
      await listRtxBrowserSessions(env, fetchImpl),
      sessionName
    );
  }

  return entry;
}

/**
 * Open and focus a tab on the platform's login page. Starting a session with a
 * URL is start-if-needed plus a focused tab, so this is also the only thing that
 * opens a tab when the session is already running.
 */
async function openRtxPlatformTab(
  platform: SocialPlatform,
  env: EnvLike,
  fetchImpl: typeof fetch,
  url: string = PLATFORM_URLS[platform].setupUrl,
  sessionName = RTX_PUBLISH_SESSION_NAME
): Promise<void> {
  await ensureRtxPublishSessionRegistered(env, fetchImpl, sessionName);
  await startRtxBrowserSession(
    { sessionName, url },
    env,
    fetchImpl
  );
}

export function getPlatformHomeUrl(platform: SocialPlatform): string {
  return PLATFORM_URLS[platform].homeUrl;
}

export async function withPlatformBrowserPage<T>(
  platform: SocialPlatform,
  sessionName: string,
  callback: (page: Page) => Promise<T>,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const entry = await ensureRtxSessionRunning(env, fetchImpl, sessionName);
  const debugPort = resolveRtxDebugPort(entry);
  if (!debugPort) throw new Error(`No debug port for browser session ${sessionName}`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  try {
    let page = findPlatformPage(browser, PLATFORM_URLS[platform].host);
    if (!page) {
      await openRtxPlatformTab(
        platform,
        env,
        fetchImpl,
        PLATFORM_URLS[platform].homeUrl,
        sessionName
      );
      page = await waitForPlatformPage(browser, PLATFORM_URLS[platform].host, PLATFORM_TAB_WAIT_MS);
    }
    if (!page) throw new Error(`No ${platform} tab available in ${sessionName}`);
    return await callback(page);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function openPlatformBrowserSession(
  platform: SocialPlatform,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ sessionName: string; opened: boolean }> {
  if (isRtxEmbedded(env)) {
    await openRtxPlatformTab(platform, env, fetchImpl);
    return { sessionName: RTX_PUBLISH_SESSION_NAME, opened: true };
  }

  await setupSession(asBrowserPlatform(platform));
  return { sessionName: RTX_PUBLISH_SESSION_NAME, opened: true };
}

export async function validatePlatformBrowserSession(
  platform: SocialPlatform,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ isValid: boolean; detectedHandle: string | null; lastValidatedAt: number | null }> {
  if (isRtxEmbedded(env)) {
    const entry = await ensureRtxSessionRunning(env, fetchImpl);
    const debugPort = resolveRtxDebugPort(entry);
    if (!debugPort) {
      return { isValid: false, detectedHandle: null, lastValidatedAt: null };
    }

    const { isLoggedIn, detectedHandle } = await detectLoggedInViaCdp(
      platform,
      debugPort,
      // Only reached when the session has no tab for this platform.
      () => openRtxPlatformTab(platform, env, fetchImpl, PLATFORM_URLS[platform].homeUrl)
    );
    const lastValidatedAt = isLoggedIn ? Math.floor(Date.now() / 1000) : null;

    if (isLoggedIn) {
      const account = ensureSessionPlatformAccount(platform, detectedHandle);
      const connection = ensureBrowserConnection({
        sessionName: RTX_PUBLISH_SESSION_NAME,
        kind: "shared",
        source: "browser-session-validation",
      });
      const identity = normalizePlatformTargetIdentity(platform, detectedHandle);
      registerPlatformTarget({
        connectionId: connection.id,
        platform,
        kind: defaultTargetKind(platform),
        name: detectedHandle ?? account.displayName,
        handle: identity.handle,
        externalId: identity.externalId,
        platformAccountId: account.id,
        capabilities: defaultTargetCapabilities(platform),
        source: "browser-session-validation",
        verifiedAt: lastValidatedAt,
      });
      if (account) {
        updatePlatformAccount(account.id, {
          status: "active",
          ...(lastValidatedAt ? { lastSyncedAt: lastValidatedAt } : {}),
        });
      }
    }

    return { isValid: isLoggedIn, detectedHandle, lastValidatedAt };
  }

  const isValid = await validateSession(asBrowserPlatform(platform));
  const account = getPlatformAccountByPlatform(platform);
  if (isValid) {
    ensureSessionPlatformAccount(platform, account?.displayName ?? null);
  }
  const legacy = loadSession(asBrowserPlatform(platform));
  return {
    isValid,
    detectedHandle: account?.displayName ?? null,
    lastValidatedAt: legacy?.lastValidatedAt ?? null,
  };
}

/** Clear browser/session connection only — preserves OAuth credentials when present. */
export async function disconnectPlatformBrowserSession(
  platform: SocialPlatform
): Promise<void> {
  clearSession(asBrowserPlatform(platform));
  const account = getPlatformAccountByPlatform(platform);
  if (account?.authType === "session" && !account.credentialsEncrypted) {
    deletePlatformAccount(account.id);
  }
}

export type PlatformConnectionPayload = {
  connected: boolean;
  oauthConnected: boolean;
  connectionVia: "browser" | "oauth" | null;
  hasBrowserSession: boolean;
  importStats: ReturnType<typeof getPlatformImportStats>;
  syncStats: Record<string, { totalSynced: number; lastSyncedAt: number | null }>;
  account: {
    id: string;
    displayName: string | null;
    status: "active" | "paused" | "needs_reauth" | null;
    lastSyncedAt: number | null;
    createdAt: number | null;
    grantedScopes: string;
    syncCapable: boolean;
    authType: string | null;
  } | null;
  targets: ReturnType<typeof toPlatformTargetView>[];
};

export async function buildSocialPlatformConnectionPayload(
  platform: SocialPlatform,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<PlatformConnectionPayload> {
  const account = getPlatformAccountByPlatform(platform);
  const importStats = getPlatformImportStats(platform);
  const sessionStatus = await getPlatformSessionStatus(platform, env, fetchImpl);
  const oauthConnected = isOAuthConnected(account);
  const sessionConnected = isSessionAccountConnected(account, sessionStatus);
  const connected = oauthConnected || sessionConnected;
  const { grantedScopes, syncCapable } = readOAuthScopes(account);

  const syncStats: Record<string, { totalSynced: number; lastSyncedAt: number | null }> = {};
  if (account) {
    for (const cursor of listSyncCursors(account.id)) {
      syncStats[cursor.dataType] = {
        totalSynced: cursor.totalItemsSynced ?? 0,
        lastSyncedAt: cursor.lastSyncCompletedAt,
      };
    }
  }

  const connectionVia = sessionConnected
    ? "browser"
    : oauthConnected
      ? "oauth"
      : null;

  return {
    connected,
    oauthConnected,
    connectionVia,
    hasBrowserSession: sessionStatus.hasSession,
    importStats,
    syncStats,
    account: account
      ? {
          id: account.id,
          displayName: account.displayName,
          status: account.status,
          lastSyncedAt: account.lastSyncedAt,
          createdAt: account.createdAt,
          grantedScopes,
          syncCapable,
          authType: account.authType,
        }
      : null,
    targets: listPlatformTargets({ platform }).map(toPlatformTargetView),
  };
}
