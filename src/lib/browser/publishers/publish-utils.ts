import { join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { nanoid } from "nanoid";
import { chromium } from "playwright";
import type { Page, BrowserContext, Browser } from "playwright";
import { loadSession } from "@/lib/browser/session";
import { randomViewport, sleep } from "@/lib/browser/anti-detection";
import type { BrowserPlatform, BrowserSession } from "@/lib/browser/types";
import { getMediaAsset, MEDIA_DIR } from "@/lib/db/queries/media";
import { PublishError } from "@/lib/browser/publishers/types";
import type { PublishMode } from "@/lib/browser/publishers/types";

const dataDir = process.env.SIGNALS_DATA_DIR?.replace("~", homedir()) ?? join(homedir(), ".signals");
const PROFILES_DIR = join(dataDir, "browser-profiles");
const SCREENSHOTS_DIR = join(dataDir, "media");

const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
];

const PLATFORM_LOGIN_URLS: Record<BrowserPlatform, string> = {
  x: "/login",
  linkedin: "/login",
  facebook: "/login",
};

/** Load and validate a browser session, throwing PublishError if missing. */
export function ensureSession(platform: BrowserPlatform): BrowserSession {
  const session = loadSession(platform);
  if (!session) {
    throw new PublishError(
      `No browser session found for ${platform}. Set up a session in Settings first.`,
      "session_expired"
    );
  }
  return session;
}

/** Create a Playwright browser context based on publish mode.
 * Both modes use persistent context with system Chrome for anti-detection.
 * Auto mode: headed, auto-closes after posting.
 * Review mode: headed, waits for user interaction.
 */
export async function createPublishContext(
  session: BrowserSession,
  mode: PublishMode
): Promise<{ browser: Browser | null; context: BrowserContext; page: Page }> {
  const profileDir = join(PROFILES_DIR, session.platform);
  mkdirSync(profileDir, { recursive: true });

  // Clear stale locks from crashed/hung previous processes
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { unlinkSync(join(profileDir, name)); } catch { /* ignore */ }
  }

  const viewport = randomViewport();

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
      viewport,
      args: STEALTH_ARGS,
    });
  } catch {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport,
      args: STEALTH_ARGS,
    });
  }

  const page = context.pages()[0] || await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return { browser: null, context, page };
}

/** Save a screenshot of the current page state. Returns the file path. */
export async function captureScreenshot(page: Page): Promise<string> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filename = `screenshot-${nanoid(8)}.png`;
  const filepath = join(SCREENSHOTS_DIR, filename);
  const buffer = await page.screenshot({ type: "png" });
  writeFileSync(filepath, buffer);
  return filepath;
}

/** Resolve media asset IDs to absolute file paths on disk. */
export function resolveMediaPaths(assetIds: string[]): string[] {
  const paths: string[] = [];
  for (const id of assetIds) {
    const asset = getMediaAsset(id);
    if (asset) {
      paths.push(join(MEDIA_DIR, asset.storagePath));
    }
  }
  return paths;
}

/** Check if the page has been redirected to a login page (session expired). */
export function detectSessionExpired(page: Page, platform: BrowserPlatform): boolean {
  const url = page.url().toLowerCase();
  const loginPath = PLATFORM_LOGIN_URLS[platform];
  return url.includes(loginPath);
}

/** Detect CAPTCHA or verification challenges. */
export function detectCaptcha(page: Page): boolean {
  const title = page.url().toLowerCase();
  return title.includes("verify") || title.includes("challenge") || title.includes("captcha");
}

/** Type text character-by-character with random delay to mimic human input. */
export async function humanTypeText(
  page: Page,
  selector: string,
  text: string,
  baseDelayMs: number = 20
): Promise<void> {
  const element = page.locator(selector).first();
  await element.waitFor({ timeout: 10_000 });
  await element.click();
  await sleep(200);

  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    // Random delay between characters: baseDelay +/- 50%
    const jitter = baseDelayMs * (0.5 + Math.random());
    await sleep(jitter);
  }
}
