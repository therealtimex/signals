import type { Page } from "playwright";
import { sleep } from "@/lib/browser/anti-detection";
import { captureScreenshot, detectCaptcha } from "@/lib/browser/publishers/publish-utils";
import { PublishError } from "@/lib/browser/publishers/types";
import { X_HOME_URL } from "@/lib/browser/rtx-publish/constants";
import {
  X_LOGGED_IN_MARKERS,
  X_PROFILE_HANDLE_SELECTORS,
  X_SELECTORS,
} from "@/lib/browser/rtx-publish/x-publish-selectors";
import { isXContentUrl } from "@/lib/browser/rtx-publish/x-publish-url";

const SESSION_EXPIRED_MESSAGE =
  "X is not logged in on RealTimeX Browser. Open the signals-publish session and sign in to X.";

const HANDLE_MISSING_MESSAGE =
  "Could not detect the logged-in X handle. Reload X in the signals-publish session and try again.";

const LOGIN_CONFIRM_TIMEOUT_MS = 20_000;
const LOGIN_POLL_MS = 500;

const RESERVED_PROFILE_SEGMENTS = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "i",
  "search",
  "settings",
  "compose",
  "login",
]);

/** True when the page URL indicates an X login / auth flow. */
export function isXLoginUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("/login") ||
    lower.includes("/i/flow/login") ||
    lower.includes("/oauth") ||
    lower.includes("/account/access")
  );
}

/** Parse a profile `href` into `@handle` when possible. */
export function handleFromProfileHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/")) return null;
  const segment = href.replace(/^\//, "").split("/")[0];
  if (!segment || RESERVED_PROFILE_SEGMENTS.has(segment.toLowerCase())) return null;
  return segment.startsWith("@") ? segment : `@${segment}`;
}

async function markerCount(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count().catch(() => 0);
}

async function waitForXLoginChrome(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isXLoggedInPage(page)) return true;
    await sleep(250);
  }
  return isXLoggedInPage(page);
}

async function hasLoggedInDomMarkers(page: Page): Promise<boolean> {
  return page
    .evaluate((selectors) => {
      for (const selector of selectors) {
        if (document.querySelector(selector)) return true;
      }
      return false;
    }, [...X_LOGGED_IN_MARKERS])
    .catch(() => false);
}

/** True when common logged-in chrome is present in the DOM (desktop or mobile). */
export async function isXLoggedInPage(page: Page): Promise<boolean> {
  if (isXLoginUrl(page.url())) return false;

  const loginCount = await markerCount(page, X_SELECTORS.loginButton);
  if (loginCount > 0) {
    const loginVisible = await page
      .locator(X_SELECTORS.loginButton)
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) return false;
  }

  if (await hasLoggedInDomMarkers(page)) return true;

  for (const selector of X_LOGGED_IN_MARKERS) {
    if ((await markerCount(page, selector)) > 0) return true;
  }

  return false;
}

/** Read @handle from profile navigation links when logged in. */
export async function detectXDisplayHandle(page: Page): Promise<string | null> {
  for (const selector of X_PROFILE_HANDLE_SELECTORS) {
    const href = await page
      .locator(selector)
      .first()
      .getAttribute("href")
      .catch(() => null);
    const handle = handleFromProfileHref(href);
    if (handle) return handle;
  }

  const navHref = await page
    .evaluate((reservedSegments) => {
      const reserved = new Set(reservedSegments);
      for (const link of document.querySelectorAll('nav a[href^="/"]')) {
        const href = link.getAttribute("href");
        if (!href) continue;
        const segment = href.replace(/^\//, "").split("/")[0]?.toLowerCase();
        if (segment && !reserved.has(segment)) return href;
      }
      return null;
    }, [...RESERVED_PROFILE_SEGMENTS])
    .catch(() => null);

  return handleFromProfileHref(navHref);
}

/** Check logged-in state; map login redirects and missing selectors to session_expired. */
export async function assertXLoggedIn(page: Page): Promise<void> {
  if (isXLoginUrl(page.url())) {
    throw new PublishError(SESSION_EXPIRED_MESSAGE, "session_expired");
  }

  const deadline = Date.now() + LOGIN_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isXLoggedInPage(page)) return;
    await sleep(LOGIN_POLL_MS);
  }

  if (isXLoginUrl(page.url())) {
    throw new PublishError(SESSION_EXPIRED_MESSAGE, "session_expired");
  }

  throw new PublishError(
    "X login could not be confirmed on RealTimeX Browser. Open the signals-publish session and sign in to X.",
    "session_expired"
  );
}

/** Navigate home when needed, validate login, require a verifiable handle before compose/submit. */
export async function prepareLoggedInXPage(
  page: Page,
  knownHandle?: string | null
): Promise<string> {
  await page.bringToFront().catch(() => {});

  if (!(await waitForXLoginChrome(page, 5_000))) {
    try {
      await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      throw new PublishError("Timed out loading X in RealTimeX Browser.", "timeout");
    }
    await sleep(2000);
  } else if (!isXContentUrl(page.url()) || isXLoginUrl(page.url())) {
    try {
      await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      throw new PublishError("Timed out loading X in RealTimeX Browser.", "timeout");
    }
    await sleep(2000);
  } else {
    await sleep(1000);
  }

  if (detectCaptcha(page)) {
    await captureScreenshot(page);
    throw new PublishError("CAPTCHA or verification challenge detected.", "captcha");
  }

  await assertXLoggedIn(page);
  if (knownHandle?.startsWith("@")) {
    return knownHandle;
  }
  const handle = await detectXDisplayHandle(page);
  if (!handle) {
    throw new PublishError(HANDLE_MISSING_MESSAGE, "session_expired");
  }
  return handle;
}
