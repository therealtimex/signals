import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { chromium, type BrowserContext, type Browser } from "playwright";
import { encrypt, decrypt } from "@/lib/auth/crypto";
import { randomViewport } from "@/lib/browser/anti-detection";
import type { BrowserPlatform, BrowserSession, CookieData } from "@/lib/browser/types";

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const SESSIONS_DIR = join(dataDir, "sessions");
const PROFILES_DIR = join(dataDir, "browser-profiles");

/** Chromium args that remove automation fingerprints X/Twitter checks for. */
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];

/** Platform-specific login URLs and logged-in selectors. */
const PLATFORM_CONFIG: Record<
  BrowserPlatform,
  { loginUrl: string; homeUrl: string; loggedInSelector: string; loggedOutSelector: string }
> = {
  x: {
    loginUrl: "https://x.com/login",
    homeUrl: "https://x.com/home",
    loggedInSelector: "[data-testid=\"primaryColumn\"]",
    loggedOutSelector: "[data-testid=\"loginButton\"]",
  },
  linkedin: {
    loginUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/feed/",
    loggedInSelector: ".global-nav__me, .scaffold-layout__main, [data-test-icon=\"nav-home-icon\"]",
    loggedOutSelector: ".sign-in-form, #username",
  },
  facebook: {
    loginUrl: "https://www.facebook.com/login",
    homeUrl: "https://www.facebook.com/",
    loggedInSelector:
      'div[role="navigation"], [aria-label="Account"], [aria-label="Your profile"], [data-pagelet="LeftRail"]',
    loggedOutSelector: '#loginform, [data-testid="royal_login_form"], form[action*="login"], #email',
  },
};

/** Get the encrypted session file path for a platform. */
function sessionPath(platform: BrowserPlatform): string {
  return join(SESSIONS_DIR, `${platform}-browser.json`);
}

/** Check whether a stored session file exists for a platform. */
export function hasSession(platform: BrowserPlatform): boolean {
  return existsSync(sessionPath(platform));
}

/** Load and decrypt a stored session. Returns null if none exists or decryption fails. */
export function loadSession(platform: BrowserPlatform): BrowserSession | null {
  const path = sessionPath(platform);
  if (!existsSync(path)) return null;

  try {
    const encrypted = readFileSync(path, "utf-8");
    const json = decrypt(encrypted);
    return JSON.parse(json) as BrowserSession;
  } catch {
    return null;
  }
}

/** Encrypt and store a session to disk. */
export function saveSession(session: BrowserSession): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const json = JSON.stringify(session);
  const encrypted = encrypt(json);
  writeFileSync(sessionPath(session.platform), encrypted, "utf-8");
}

/** Delete a stored session file. */
export function clearSession(platform: BrowserPlatform): void {
  const path = sessionPath(platform);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

/**
 * Launch a headed (visible) browser for manual login.
 * Uses persistent context + system Chrome + stealth flags to avoid bot detection.
 * The user logs in themselves (handles 2FA, CAPTCHA).
 * Returns the captured session once the user navigates to the home page.
 */
/** Remove Chromium singleton lock files left by crashed/hung Playwright processes. */
function clearStaleLocks(profileDir: string): void {
  const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
  for (const name of lockFiles) {
    const p = join(profileDir, name);
    try { unlinkSync(p); } catch { /* ignore if missing */ }
  }
}

export async function setupSession(platform: BrowserPlatform): Promise<BrowserSession> {
  const config = PLATFORM_CONFIG[platform];
  const viewport = randomViewport();
  const profileDir = join(PROFILES_DIR, platform);
  mkdirSync(profileDir, { recursive: true });

  // Clear stale locks from crashed/hung previous Playwright processes
  clearStaleLocks(profileDir);

  // Use persistent context with system Chrome to avoid bot detection.
  // Persistent context keeps login state between runs (like a real user).
  // Stealth args remove navigator.webdriver and other automation signals.
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      viewport,
      args: STEALTH_ARGS,
    });
  } catch {
    // Fallback: system Chrome unavailable, use bundled Chromium with stealth args
    clearStaleLocks(profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport,
      args: STEALTH_ARGS,
    });
  }

  const page = context.pages()[0] || await context.newPage();

  // Remove webdriver flag that X checks for
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

  // Check if already logged in (persistent context may have valid cookies).
  // If URL already redirected away from login, skip waiting for manual login.
  const currentUrl = page.url();
  const alreadyLoggedIn = !currentUrl.includes("/login") && !currentUrl.includes("/checkpoint");

  if (!alreadyLoggedIn) {
    // Wait for user to complete login — detect by logged-in element OR URL change.
    // Race: element selector vs URL leaving the login page. Generous timeout for 2FA.
    await Promise.race([
      page.waitForSelector(config.loggedInSelector, { timeout: 300_000 }).catch(() => null),
      page.waitForURL((url) => {
        const path = url.pathname;
        return !path.includes("/login") && !path.includes("/checkpoint") && path !== "/";
      }, { timeout: 300_000 }),
    ]);
  }

  // Let the page fully load before capturing cookies
  await page.waitForLoadState("networkidle").catch(() => null);

  // Capture cookies
  const playwrightCookies = await context.cookies();
  const cookies: CookieData[] = playwrightCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));

  const userAgent = await page.evaluate(() => navigator.userAgent);
  await context.close();

  const now = Math.floor(Date.now() / 1000);
  const session: BrowserSession = {
    platform,
    cookies,
    userAgent,
    viewport,
    createdAt: now,
    lastValidatedAt: now,
  };

  saveSession(session);
  return session;
}

/**
 * Create a headed Playwright context with stored session cookies.
 * Used by scrapers and enrichment for actual profile navigation.
 * Uses system Chrome + stealth args to avoid bot detection.
 */
export async function createSessionContext(
  session: BrowserSession
): Promise<{ browser: Browser; context: BrowserContext }> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: "chrome",
      args: STEALTH_ARGS,
    });
  } catch {
    browser = await chromium.launch({
      headless: false,
      args: STEALTH_ARGS,
    });
  }
  const context = await browser.newContext({
    viewport: session.viewport,
    userAgent: session.userAgent,
  });

  // Remove webdriver flag before any page loads
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // Restore cookies
  await context.addCookies(
    session.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }))
  );

  return { browser, context };
}

/**
 * Validate a stored session by navigating to the platform's home page
 * and checking for logged-in state. Updates lastValidatedAt on success.
 * Returns true if session is still valid.
 */
export async function validateSession(platform: BrowserPlatform): Promise<boolean> {
  const session = loadSession(platform);
  if (!session) return false;

  const config = PLATFORM_CONFIG[platform];
  let browser: Browser | null = null;

  try {
    const ctx = await createSessionContext(session);
    browser = ctx.browser;
    const page = await ctx.context.newPage();

    await page.goto(config.homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Check for logged-in indicator: try selector first, fall back to URL check
    const selectorMatch = page
      .waitForSelector(config.loggedInSelector, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const urlMatch = page.url().includes("/feed") || page.url().includes("/home");
    const loggedIn = await selectorMatch || urlMatch;

    if (loggedIn) {
      // Update validation timestamp and re-save
      session.lastValidatedAt = Math.floor(Date.now() / 1000);
      saveSession(session);
    }

    return loggedIn;
  } catch {
    return false;
  } finally {
    await browser?.close();
  }
}
