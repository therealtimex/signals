import { chromium, type Page } from "playwright";
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
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import { isRtxEmbedded, type EnvLike } from "@/lib/rtx/env";
import {
  createRtxBrowserSession,
  findRtxBrowserSession,
  listRtxBrowserSessions,
  resolveRtxDebugPort,
  startRtxBrowserSession,
  type RtxBrowserSessionEntry,
} from "@/lib/rtx/browser-sessions";

export type SocialPlatform = "x" | "linkedin";

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
  };

const LOGGED_IN_SELECTORS: Record<SocialPlatform, string> = {
  x: '[data-testid="primaryColumn"]',
  linkedin: ".global-nav__me, .scaffold-layout__main, [data-test-icon=\"nav-home-icon\"]",
};

const LOGGED_OUT_SELECTORS: Record<SocialPlatform, string> = {
  x: '[data-testid="loginButton"]',
  linkedin: ".sign-in-form, #username",
};

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

async function detectLoggedInViaCdp(
  platform: SocialPlatform,
  debugPort: number
): Promise<{ isLoggedIn: boolean; detectedHandle: string | null }> {
  const urls = PLATFORM_URLS[platform];
  let browser = null;

  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const contexts = browser.contexts();
    let page: Page | null = null;

    for (const context of contexts) {
      for (const candidate of context.pages()) {
        if (urlMatchesPlatformHost(candidate.url(), urls.host)) {
          page = candidate;
          break;
        }
      }
      if (page) break;
    }

    if (!page) {
      const context = contexts[0] ?? (await browser.newContext());
      page = await context.newPage();
      await page.goto(urls.homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }

    const loggedOut = await page
      .locator(LOGGED_OUT_SELECTORS[platform])
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (loggedOut) {
      return { isLoggedIn: false, detectedHandle: null };
    }

    const loggedIn = await page
      .locator(LOGGED_IN_SELECTORS[platform])
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    let detectedHandle: string | null = null;
    if (loggedIn) {
      if (platform === "x") {
        detectedHandle = await page
          .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
          .getAttribute("aria-label")
          .then((label) => {
            const match = label?.match(/@(\w+)/);
            return match ? `@${match[1]}` : null;
          })
          .catch(() => null);
      } else {
        detectedHandle = await page
          .locator('a.global-nav__primary-link[href*="/in/"]')
          .first()
          .getAttribute("href")
          .then((href) => {
            const match = href?.match(/\/in\/([^/?#]+)/);
            return match?.[1] ?? null;
          })
          .catch(() => null);
      }
    }

    return { isLoggedIn: loggedIn, detectedHandle };
  } catch {
    return { isLoggedIn: false, detectedHandle: null };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function ensureRtxSessionRunning(
  platform: SocialPlatform,
  env: EnvLike,
  fetchImpl: typeof fetch
): Promise<RtxBrowserSessionEntry | undefined> {
  const sessionName = RTX_PUBLISH_SESSION_NAME;
  const urls = PLATFORM_URLS[platform];
  let sessions = await listRtxBrowserSessions(env, fetchImpl);
  let entry = findRtxBrowserSession(sessions, sessionName);

  if (!entry) {
    await createRtxBrowserSession({ sessionName, url: urls.setupUrl }, env, fetchImpl);
    sessions = await listRtxBrowserSessions(env, fetchImpl);
    entry = findRtxBrowserSession(sessions, sessionName);
  }

  if (!entry?.running && entry?.runtime?.status !== "running") {
    await startRtxBrowserSession({ sessionName, url: urls.setupUrl }, env, fetchImpl);
    sessions = await listRtxBrowserSessions(env, fetchImpl);
    entry = findRtxBrowserSession(sessions, sessionName);
  }

  return entry;
}

export async function openPlatformBrowserSession(
  platform: SocialPlatform,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ sessionName: string; opened: boolean }> {
  if (isRtxEmbedded(env)) {
    await ensureRtxSessionRunning(platform, env, fetchImpl);
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
    const entry = await ensureRtxSessionRunning(platform, env, fetchImpl);
    const debugPort = resolveRtxDebugPort(entry);
    if (!debugPort) {
      return { isValid: false, detectedHandle: null, lastValidatedAt: null };
    }

    const { isLoggedIn, detectedHandle } = await detectLoggedInViaCdp(platform, debugPort);
    const lastValidatedAt = isLoggedIn ? Math.floor(Date.now() / 1000) : null;

    if (isLoggedIn) {
      ensureSessionPlatformAccount(platform, detectedHandle);
      const account = getPlatformAccountByPlatform(platform);
      if (account) {
        updatePlatformAccount(account.id, {
          status: "active",
          ...(lastValidatedAt ? { lastSyncedAt: lastValidatedAt } : {}),
          ...(detectedHandle ? { displayName: detectedHandle } : {}),
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
  };
}
