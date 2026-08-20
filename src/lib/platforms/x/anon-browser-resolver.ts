import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import { X_SELECTORS } from "@/lib/publish/x-browser/x-publish-selectors";
import {
  X_ANON_NAV_ORIGINS,
  X_ANON_NAV_TIMEOUT_MS,
  X_ANON_SESSION_NAME,
  isAllowedXBrowserOrigin,
} from "@/lib/platforms/x/anon-web-constants";
import { parseCanonicalXProfileUrl } from "@/lib/platforms/x/web-profile-parser";
import {
  createRtxBrowserSession,
  findRtxBrowserSession,
  listRtxBrowserSessions,
  resolveRtxDebugPort,
  startRtxBrowserSession,
  stopRtxBrowserSession,
} from "@/lib/rtx/browser-sessions";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";

export type XAnonResolveResult =
  | { status: "resolved"; handle: string }
  | { status: "terminal"; missStatus: "not_found" | "suspended" }
  | { status: "login_wall" }
  | { status: "contaminated" }
  | { status: "unavailable"; message: string }
  | { status: "timeout" };

export type XAnonHandleResolver = {
  resolve(userId: string): Promise<XAnonResolveResult>;
  dispose(): Promise<void>;
};

export type XAnonHandleResolverFactory = (
  env: EnvLike,
  fetchImpl: typeof fetch,
) => Promise<XAnonHandleResolver>;

const X_LOGGED_IN_PRIVATE_MARKERS = [
  X_SELECTORS.composeButton,
  X_SELECTORS.accountSwitcher,
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
] as const;

let resolverQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function hasVisibleMarker(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    if (await isVisible(page, selector)) return true;
  }
  return false;
}

function isLoginOrChallengeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['x.com', 'twitter.com', 'mobile.x.com'].includes(url.hostname.toLowerCase())) return true;
    const path = url.pathname.toLowerCase();
    return path === "/" || path.includes("/login") || path.includes("/i/flow/") || path.includes("/account/access");
  } catch {
    return true;
  }
}

export function shouldAllowXBrowserRequest(rawUrl: string): boolean {
  return rawUrl.startsWith("data:") || rawUrl.startsWith("blob:") || rawUrl === "about:blank" || isAllowedXBrowserOrigin(rawUrl);
}

async function installOriginFence(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    if (shouldAllowXBrowserRequest(route.request().url())) await route.continue();
    else await route.abort("blockedbyclient");
  });
}

async function probeContamination(page: Page): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    if (await hasVisibleMarker(page, X_LOGGED_IN_PRIVATE_MARKERS)) return true;
    if (await isVisible(page, X_SELECTORS.loginButton)) return false;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

async function classifyPage(page: Page): Promise<XAnonResolveResult> {
  const parsed = parseCanonicalXProfileUrl(page.url());
  if (parsed) return { status: "resolved", handle: parsed.handle };
  if (isLoginOrChallengeUrl(page.url())) return { status: "login_wall" };

  const emptyText = await page.locator('[data-testid="emptyState"]').first().textContent().catch(() => null);
  const normalized = emptyText?.toLowerCase().replace(/[’]/g, "'") ?? "";
  if (normalized.includes("doesn't exist")) return { status: "terminal", missStatus: "not_found" };
  if (normalized.includes("suspended")) return { status: "terminal", missStatus: "suspended" };
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/challenge|verify you are human|unusual activity/i.test(bodyText)) return { status: "login_wall" };
  return { status: "timeout" };
}

async function waitForResolution(page: Page, userId: string): Promise<XAnonResolveResult> {
  const deadline = Date.now() + X_ANON_NAV_TIMEOUT_MS;
  const numericPath = `/i/user/${userId}`;
  for (;;) {
    let currentPath = "";
    try {
      currentPath = new URL(page.url()).pathname;
    } catch {
      // Keep polling until the bounded deadline.
    }
    if (currentPath !== numericPath) return classifyPage(page);
    const terminal = await page.locator('[data-testid="emptyState"]').first().isVisible().catch(() => false);
    if (terminal) return classifyPage(page);
    if (Date.now() >= deadline) return classifyPage(page);
    await sleep(200);
  }
}

async function waitForRtxDebugPort(env: EnvLike, fetchImpl: typeof fetch): Promise<number | null> {
  const deadline = Date.now() + X_ANON_NAV_TIMEOUT_MS;
  for (;;) {
    const entry = findRtxBrowserSession(
      await listRtxBrowserSessions(env, fetchImpl),
      X_ANON_SESSION_NAME,
    );
    const port = resolveRtxDebugPort(entry);
    if (port) return port;
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

async function findRtxXPage(browser: Browser): Promise<Page | null> {
  const deadline = Date.now() + X_ANON_NAV_TIMEOUT_MS;
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (new URL(page.url()).hostname.endsWith("x.com")) return page;
        } catch {
          // Ignore tabs that have not navigated yet.
        }
      }
    }
    if (Date.now() >= deadline) return null;
    await sleep(200);
  }
}

async function acquireQueue(): Promise<() => void> {
  const previous = resolverQueue;
  let release!: () => void;
  resolverQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}

export async function createAnonHandleResolver(
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
  sessionName: string = X_ANON_SESSION_NAME,
): Promise<XAnonHandleResolver> {
  if (sessionName === RTX_PUBLISH_SESSION_NAME) {
    throw new Error("Anonymous X resolver refuses the connected publish session");
  }
  if (sessionName !== X_ANON_SESSION_NAME) {
    throw new Error(`Anonymous X resolver requires session ${X_ANON_SESSION_NAME}`);
  }

  const release = await acquireQueue();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let firstNavigation = true;
  let disposed = false;

  try {
    if (isRtxEmbedded(env)) {
      await createRtxBrowserSession({
        sessionName,
        guardrails: {
          mode: "unrestricted",
          allowedOrigins: [...X_ANON_NAV_ORIGINS],
          blockedOrigins: [],
        },
      }, env, fetchImpl);
    } else {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      page = await context.newPage();
      await installOriginFence(page);
    }
  } catch (error) {
    release();
    throw error;
  }

  return {
    async resolve(userId: string): Promise<XAnonResolveResult> {
      if (!/^\d+$/.test(userId)) return { status: "unavailable", message: "X user ID must be numeric" };
      try {
        const target = `https://x.com/i/user/${userId}`;
        if (isRtxEmbedded(env) && firstNavigation) {
          await startRtxBrowserSession({ sessionName, url: target }, env, fetchImpl);
          const port = await waitForRtxDebugPort(env, fetchImpl);
          if (!port) return { status: "unavailable", message: "Anonymous X browser debug port unavailable" };
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
          page = await findRtxXPage(browser);
          if (!page) return { status: "unavailable", message: "Anonymous X browser tab unavailable" };
          await installOriginFence(page).catch(() => undefined);
        } else if (page) {
          await page.goto(target, { waitUntil: "domcontentloaded", timeout: X_ANON_NAV_TIMEOUT_MS }).catch(() => undefined);
        }
        firstNavigation = false;
        if (!page) return { status: "unavailable", message: "Anonymous X browser page unavailable" };
        const result = await waitForResolution(page, userId);
        if (await probeContamination(page)) return { status: "contaminated" };
        return result;
      } catch (error) {
        return {
          status: "unavailable",
          message: error instanceof Error ? error.message : "Anonymous X browser failed",
        };
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        if (isRtxEmbedded(env)) {
          await stopRtxBrowserSession(sessionName, env, fetchImpl).catch(() => undefined);
        }
      } finally {
        release();
      }
    },
  };
}
