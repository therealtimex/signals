import { PublishError } from "@/lib/browser/publishers/types";
import type { BrowserTabRecord, DesktopBrowserApiClient } from "@/lib/browser/rtx-publish/desktop-browser-client";
import { handleFromProfileHref } from "@/lib/browser/rtx-publish/x-publish-login";

export type TabLoginProbeResult = {
  tab: BrowserTabRecord;
  handle: string;
};

const RESERVED_PROFILE_SEGMENTS = [
  "home",
  "explore",
  "notifications",
  "messages",
  "i",
  "search",
  "settings",
  "compose",
  "login",
];

/** JavaScript executed in the real BrowserView via RTX evaluate-tab. */
export const X_TAB_LOGIN_PROBE_SCRIPT = `(() => {
  const loginButton = document.querySelector('[data-testid="loginButton"]');
  if (loginButton) {
    const rect = loginButton.getBoundingClientRect();
    const style = window.getComputedStyle(loginButton);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
    if (visible) {
      return { loggedIn: false };
    }
  }

  const markerIds = [
    "primaryColumn",
    "SideNav_NewTweet_Button",
    "SideNav_AccountSwitcher_Button",
    "AppTabBar_Profile_Link",
  ];
  let hasMarker = false;
  for (const id of markerIds) {
    if (document.querySelector('[data-testid="' + id + '"]')) {
      hasMarker = true;
      break;
    }
  }
  if (!hasMarker && !document.querySelector('a[aria-label="Profile"]')) {
    return { loggedIn: false };
  }

  const reserved = new Set(${JSON.stringify(RESERVED_PROFILE_SEGMENTS)});
  const selectors = [
    '[data-testid="AppTabBar_Profile_Link"]',
    'a[aria-label="Profile"]',
    '[data-testid="SideNav_AccountSwitcher_Button"] a[href^="/"]',
  ];
  for (const selector of selectors) {
    const link = document.querySelector(selector);
    const href = link?.getAttribute("href");
    if (!href || !href.startsWith("/")) continue;
    const segment = href.replace(/^\\//, "").split("/")[0]?.toLowerCase();
    if (segment && !reserved.has(segment)) {
      const handle = segment.startsWith("@") ? segment : "@" + segment;
      return { loggedIn: true, handle };
    }
  }

  for (const link of document.querySelectorAll('nav a[href^="/"]')) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const segment = href.replace(/^\\//, "").split("/")[0]?.toLowerCase();
    if (segment && !reserved.has(segment)) {
      const handle = segment.startsWith("@") ? segment : "@" + segment;
      return { loggedIn: true, handle };
    }
  }

  return { loggedIn: true, handle: null };
})()`;

type EvaluateProbeValue = {
  loggedIn?: boolean;
  handle?: string | null;
};

function parseEvaluateProbeValue(body: Record<string, unknown>): EvaluateProbeValue | null {
  const value = body.value ?? body.result;
  if (!value || typeof value !== "object") return null;
  return value as EvaluateProbeValue;
}

/** Probe X tabs through BrowserView evaluate-tab (bypasses flaky Playwright CDP DOM). */
export async function probeLoggedInXTab(
  tabs: BrowserTabRecord[],
  client: DesktopBrowserApiClient
): Promise<TabLoginProbeResult | null> {
  for (const tab of tabs) {
    if (!tab.ref) continue;

    await client.focusTab(tab.ref).catch(() => {});

    let body: Record<string, unknown>;
    try {
      body = await client.evaluateTab(tab.ref, X_TAB_LOGIN_PROBE_SCRIPT);
    } catch {
      continue;
    }

    const probe = parseEvaluateProbeValue(body);
    if (!probe?.loggedIn) continue;

    const handle =
      typeof probe.handle === "string" && probe.handle.trim().startsWith("@")
        ? probe.handle.trim()
        : handleFromProfileHref(
            typeof probe.handle === "string" && probe.handle.startsWith("/")
              ? probe.handle
              : null
          );

    if (!handle) {
      throw new PublishError(
        "Could not detect the logged-in X handle. Reload X in the signals-publish session and try again.",
        "session_expired"
      );
    }

    return { tab, handle };
  }

  return null;
}
