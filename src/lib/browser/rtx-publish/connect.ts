import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import {
  fetchCdpJsonPageTargets,
  type CdpJsonPageTarget,
} from "@/lib/browser/rtx-publish/cdp-json-list";
import { X_HOME_URL } from "@/lib/browser/rtx-publish/constants";
import { isXLoggedInPage } from "@/lib/browser/rtx-publish/x-publish-login";
import { isXContentUrl, scoreXContentPageUrl } from "@/lib/browser/rtx-publish/x-publish-url";

export { isXContentUrl, isShellOrDevtoolsUrl, scoreXContentPageUrl } from "@/lib/browser/rtx-publish/x-publish-url";

export type ConnectToXContentPageDeps = {
  fetchImpl?: typeof fetch;
  preferredTabUrl?: string;
};

function collectAllPages(browser: Browser): Page[] {
  const pages: Page[] = [];
  for (const context of browser.contexts()) {
    pages.push(...context.pages());
  }
  return pages;
}

function sortXContentCdpTargets(
  targets: CdpJsonPageTarget[],
  preferredTabUrl?: string
): CdpJsonPageTarget[] {
  return [...targets]
    .filter((target) => scoreXContentPageUrl(target.url) >= 0)
    .sort((left, right) => {
      if (preferredTabUrl) {
        const leftExact = left.url === preferredTabUrl ? 1 : 0;
        const rightExact = right.url === preferredTabUrl ? 1 : 0;
        if (leftExact !== rightExact) return rightExact - leftExact;
      }
      return scoreXContentPageUrl(right.url) - scoreXContentPageUrl(left.url);
    });
}

function findPlaywrightPageForTarget(pages: Page[], target: CdpJsonPageTarget): Page | null {
  const exact = pages.find((page) => page.url() === target.url);
  if (exact) return exact;

  try {
    const targetUrl = new URL(target.url);
    return (
      pages.find((page) => {
        try {
          const pageUrl = new URL(page.url());
          return (
            pageUrl.hostname === targetUrl.hostname &&
            pageUrl.pathname === targetUrl.pathname
          );
        } catch {
          return false;
        }
      }) ?? null
    );
  } catch {
    return null;
  }
}

async function connectPageFromCdpTarget(
  target: CdpJsonPageTarget,
  attachedBrowser: Browser
): Promise<{ browser: Browser; page: Page } | null> {
  try {
    const pageBrowser = await chromium.connectOverCDP(target.webSocketDebuggerUrl);
    const page = collectAllPages(pageBrowser)[0];
    if (page) {
      return { browser: pageBrowser, page };
    }
    await pageBrowser.close().catch(() => {});
  } catch {
    // Fall back to the browser-level attachment when page websocket is unavailable.
  }

  const attachedPage = findPlaywrightPageForTarget(collectAllPages(attachedBrowser), target);
  if (attachedPage) {
    return { browser: attachedBrowser, page: attachedPage };
  }

  return null;
}

/** List X content pages sorted by URL preference (home first). */
export function listXContentPages(browser: Browser): Page[] {
  const pages: Page[] = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (scoreXContentPageUrl(page.url()) >= 0) {
        pages.push(page);
      }
    }
  }

  return pages.sort(
    (left, right) => scoreXContentPageUrl(right.url()) - scoreXContentPageUrl(left.url())
  );
}

/** Find the best existing X content page among connected CDP targets. */
export function findXContentPage(browser: Browser): Page | null {
  return listXContentPages(browser)[0] ?? null;
}

/** Prefer a tab that already shows logged-in X chrome (not just URL scoring). */
export async function findLoggedInXContentPage(browser: Browser): Promise<Page | null> {
  for (const page of listXContentPages(browser)) {
    await page.bringToFront().catch(() => {});
    if (await isXLoggedInPage(page)) {
      return page;
    }
  }
  return null;
}

async function connectLoggedInFromCdpTargets(
  remoteDebugPort: number,
  fetchImpl: typeof fetch,
  preferredTabUrl?: string
): Promise<{ browser: Browser; page: Page } | null> {
  const browserEndpoint = `http://127.0.0.1:${remoteDebugPort}`;
  const cdpTargets = sortXContentCdpTargets(
    await fetchCdpJsonPageTargets(remoteDebugPort, fetchImpl),
    preferredTabUrl
  );
  if (cdpTargets.length === 0) return null;

  const attachedBrowser = await chromium.connectOverCDP(browserEndpoint);

  for (const target of cdpTargets) {
    const connection = await connectPageFromCdpTarget(target, attachedBrowser);
    if (!connection) continue;

    const { browser, page } = connection;
    const ownsConnection = browser !== attachedBrowser;

    await page.bringToFront().catch(() => {});
    if (await isXLoggedInPage(page)) {
      if (!ownsConnection) {
        return { browser, page };
      }
      await attachedBrowser.close().catch(() => {});
      return { browser, page };
    }

    if (ownsConnection) {
      await browser.close().catch(() => {});
    }
  }

  await attachedBrowser.close().catch(() => {});
  return null;
}

async function connectBestFromCdpTargets(
  remoteDebugPort: number,
  fetchImpl: typeof fetch,
  preferredTabUrl?: string
): Promise<{ browser: Browser; page: Page } | null> {
  const browserEndpoint = `http://127.0.0.1:${remoteDebugPort}`;
  const cdpTargets = sortXContentCdpTargets(
    await fetchCdpJsonPageTargets(remoteDebugPort, fetchImpl),
    preferredTabUrl
  );
  if (cdpTargets.length === 0) return null;

  const attachedBrowser = await chromium.connectOverCDP(browserEndpoint);
  const target = cdpTargets[0];
  const connection = await connectPageFromCdpTarget(target, attachedBrowser);
  if (!connection) {
    await attachedBrowser.close().catch(() => {});
    return null;
  }

  if (connection.browser === attachedBrowser) {
    return connection;
  }

  await attachedBrowser.close().catch(() => {});
  return connection;
}

/**
 * Connect Playwright to RTX Browser via CDP and return an X content page.
 * Enumerates BrowserView targets from `/json/list` before falling back to context pages.
 */
export async function connectToXContentPage(
  remoteDebugPort: number,
  deps: ConnectToXContentPageDeps = {}
): Promise<{ browser: Browser; page: Page }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const preferredTabUrl = deps.preferredTabUrl;

  const loggedInFromJson = await connectLoggedInFromCdpTargets(
    remoteDebugPort,
    fetchImpl,
    preferredTabUrl
  );
  if (loggedInFromJson) {
    return loggedInFromJson;
  }

  const endpoint = `http://127.0.0.1:${remoteDebugPort}`;
  const browser = await chromium.connectOverCDP(endpoint);

  const loggedIn = await findLoggedInXContentPage(browser);
  if (loggedIn) {
    return { browser, page: loggedIn };
  }

  const fromJson = await connectBestFromCdpTargets(remoteDebugPort, fetchImpl, preferredTabUrl);
  if (fromJson) {
    await browser.close().catch(() => {});
    return fromJson;
  }

  const existing = findXContentPage(browser);
  if (existing) {
    await existing.bringToFront().catch(() => {});
    return { browser, page: existing };
  }

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("No browser context available on RTX CDP endpoint");
  }

  const page = await context.newPage();
  await page.goto(X_HOME_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return { browser, page };
}
