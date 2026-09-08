import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import { X_SELECTORS } from "@/lib/publish/x-browser/x-publish-selectors";
import {
  X_ANON_BROWSER_ARGS,
  X_ANON_BROWSER_USER_AGENT,
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

/**
 * One anonymous profile page as the browser received it. `httpStatus` is reported rather than
 * interpreted: a 404 still carries the markup that tells apart "no such account" from
 * "suspended", so only the statuses that must stop the batch short-circuit here.
 */
export type XAnonPageResult =
  | { status: "ok"; html: string; finalUrl: string; httpStatus: number }
  | { status: "rate_limited"; retryAfterSeconds?: number }
  | { status: "challenged" }
  | { status: "login_wall" }
  | { status: "contaminated" }
  | { status: "unexpected_redirect" }
  | { status: "unavailable"; message: string }
  | { status: "timeout" };

export type XAnonBrowser = {
  /** Numeric X user ID to handle, via the redirect X itself performs on `/i/user/<id>`. */
  resolve(userId: string): Promise<XAnonResolveResult>;
  /** The rendered profile page for a handle. */
  fetchProfile(handle: string): Promise<XAnonPageResult>;
  /**
   * The page the tab is already sitting on, without navigating again. `resolve` leaves the tab
   * on the canonical profile it redirected to, so the numeric path costs one page load, not two.
   */
  capturePage(expectedHandle: string): Promise<XAnonPageResult>;
  dispose(): Promise<void>;
};

/** @deprecated Name kept for callers that only resolve; `XAnonBrowser` also fetches profiles. */
export type XAnonHandleResolver = XAnonBrowser;

export type XAnonHandleResolverFactory = (
  env: EnvLike,
  fetchImpl: typeof fetch,
) => Promise<XAnonBrowser>;

const X_LOGGED_IN_PRIVATE_MARKERS = [
  X_SELECTORS.composeButton,
  X_SELECTORS.accountSwitcher,
  X_SELECTORS.profileLink,
  X_SELECTORS.desktopProfileLink,
] as const;

/** Where the session lands before its first profile request, so a guest context exists. */
const X_ANON_ENTRY_URL = "https://x.com/";

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

/**
 * Logged-in markers mean the session is carrying somebody's credentials and every read from it
 * is contaminated. The bootstrap probe polls, because markers render asynchronously; later
 * requests only re-check, because nothing in this session can log itself in mid-batch.
 */
async function probeContamination(page: Page, poll: boolean): Promise<boolean> {
  if (!poll) return hasVisibleMarker(page, X_LOGGED_IN_PRIVATE_MARKERS);
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

function readRetryAfterSeconds(headers: Record<string, string>, nowMs: number): number | undefined {
  const directRaw = headers["retry-after"]?.trim();
  if (directRaw) {
    const direct = Number(directRaw);
    if (Number.isFinite(direct) && direct >= 0) return direct;
  }
  const resetRaw = headers["x-rate-limit-reset"]?.trim();
  if (resetRaw) {
    const reset = Number(resetRaw);
    if (Number.isFinite(reset)) return Math.max(0, Math.ceil(reset - nowMs / 1000));
  }
  return undefined;
}

/** Confirm the tab is on the canonical profile it was asked for, then take its markup. */
async function readLandedPage(
  page: Page,
  expectedHandle: string,
  httpStatus: number,
): Promise<XAnonPageResult> {
  const finalUrl = page.url();
  const landed = parseCanonicalXProfileUrl(finalUrl);
  if (!landed) {
    return isLoginOrChallengeUrl(finalUrl) ? { status: "login_wall" } : { status: "unexpected_redirect" };
  }
  if (landed.handle.toLowerCase() !== expectedHandle.toLowerCase()) {
    return { status: "unexpected_redirect" };
  }
  return { status: "ok", html: await page.content(), finalUrl, httpStatus };
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
): Promise<XAnonBrowser> {
  if (sessionName === RTX_PUBLISH_SESSION_NAME) {
    throw new Error("Anonymous X resolver refuses the connected publish session");
  }
  if (sessionName !== X_ANON_SESSION_NAME) {
    throw new Error(`Anonymous X resolver requires session ${X_ANON_SESSION_NAME}`);
  }

  const release = await acquireQueue();
  const embedded = isRtxEmbedded(env);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let started = false;
  let bootstrapProbed = false;
  let disposed = false;

  try {
    if (embedded) {
      await createRtxBrowserSession({
        sessionName,
        guardrails: {
          mode: "unrestricted",
          allowedOrigins: [...X_ANON_NAV_ORIGINS],
          blockedOrigins: [],
        },
      }, env, fetchImpl);
    } else {
      // Headless Chrome is refused by X outright, so the local fallback runs headed too.
      browser = await chromium.launch({ headless: false, args: [...X_ANON_BROWSER_ARGS] });
      context = await browser.newContext({ userAgent: X_ANON_BROWSER_USER_AGENT, locale: "en-US" });
      page = await context.newPage();
      await installOriginFence(page);
    }
  } catch (error) {
    release();
    throw error;
  }

  /** Bring up the shared tab on first use. Returns null when the browser never became usable. */
  const ensurePage = async (): Promise<Page | null> => {
    if (page || !embedded || started) return page;
    started = true;
    await startRtxBrowserSession({ sessionName, url: X_ANON_ENTRY_URL }, env, fetchImpl);
    const port = await waitForRtxDebugPort(env, fetchImpl);
    if (!port) return null;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await findRtxXPage(browser);
    if (page) await installOriginFence(page).catch(() => undefined);
    return page;
  };

  /** Navigate the shared tab and report contamination once the page has settled. */
  const goto = async (target: string) => {
    const active = await ensurePage();
    if (!active) return { page: null, response: null, contaminated: false };
    const response = await active.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: X_ANON_NAV_TIMEOUT_MS,
    });
    const contaminated = await probeContamination(active, !bootstrapProbed);
    bootstrapProbed = true;
    return { page: active, response, contaminated };
  };

  return {
    async resolve(userId: string): Promise<XAnonResolveResult> {
      if (!/^\d+$/.test(userId)) return { status: "unavailable", message: "X user ID must be numeric" };
      try {
        const { page: active, contaminated } = await goto(`https://x.com/i/user/${userId}`);
        if (!active) return { status: "unavailable", message: "Anonymous X browser page unavailable" };
        if (contaminated) return { status: "contaminated" };
        return await waitForResolution(active, userId);
      } catch (error) {
        return {
          status: "unavailable",
          message: error instanceof Error ? error.message : "Anonymous X browser failed",
        };
      }
    },

    async fetchProfile(handle: string): Promise<XAnonPageResult> {
      try {
        const { page: active, response, contaminated } = await goto(`https://x.com/${handle}`);
        if (!active) return { status: "unavailable", message: "Anonymous X browser page unavailable" };
        if (contaminated) return { status: "contaminated" };

        const httpStatus = response?.status() ?? 0;
        if (httpStatus === 429) {
          const seconds = readRetryAfterSeconds(response?.headers() ?? {}, Date.now());
          return { status: "rate_limited", ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }) };
        }
        if (httpStatus === 403) return { status: "challenged" };
        return await readLandedPage(active, handle, httpStatus);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Anonymous X browser failed";
        return /timeout/i.test(message) ? { status: "timeout" } : { status: "unavailable", message };
      }
    },

    async capturePage(expectedHandle: string): Promise<XAnonPageResult> {
      if (!page) return { status: "unavailable", message: "Anonymous X browser page unavailable" };
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: X_ANON_NAV_TIMEOUT_MS });
        // The redirect target's status is not observable from here; the markup carries the verdict.
        return await readLandedPage(page, expectedHandle, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Anonymous X browser failed";
        return /timeout/i.test(message) ? { status: "timeout" } : { status: "unavailable", message };
      }
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await context?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        if (embedded) {
          await stopRtxBrowserSession(sessionName, env, fetchImpl).catch(() => undefined);
        }
      } finally {
        release();
      }
    },
  };
}
