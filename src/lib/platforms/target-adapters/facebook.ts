import {
  detectPlatformHandle,
  probePlatformLogin,
} from "@/lib/platforms/browser-connection";
import { defaultTargetCapabilities } from "@/lib/platforms/target-identity";
import { targetLabel, verifyDetectedTarget } from "@/lib/platforms/target-adapters/shared";
import type { PlatformTargetAdapter } from "@/lib/platforms/target-adapters/types";

const DISCOVERY_LOGIN_TIMEOUT_MS = 8_000;
const NON_ENTITY_PATHS = new Set([
  "adsmanager",
  "business",
  "events",
  "friends",
  "gaming",
  "groups",
  "help",
  "login",
  "marketplace",
  "memories",
  "messages",
  "notifications",
  "pages",
  "privacy",
  "recover",
  "saved",
  "settings",
  "watch",
]);

function facebookEntityFromLink(link: { name: string; href: string }) {
  const name = link.name.trim();
  if (!name) return null;

  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "facebook.com" && !hostname.endsWith(".facebook.com")) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() === "profile.php") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? { name, handle: `id:${id}` } : null;
  }
  if (segments.length !== 1) return null;

  const handle = segments[0];
  if (!/^[a-z0-9.]+$/i.test(handle) || NON_ENTITY_PATHS.has(handle.toLowerCase())) {
    return null;
  }
  return { name, handle };
}

export const facebookTargetAdapter: PlatformTargetAdapter = {
  async discover(page) {
    if (!(await probePlatformLogin("facebook", page, DISCOVERY_LOGIN_TIMEOUT_MS))) return [];

    const discovered = new Map<string, { name: string; handle: string | null }>();
    const current = await detectPlatformHandle("facebook", page, page.url());
    if (current) discovered.set(current.toLowerCase(), { name: current, handle: current });

    const menuOpened = await page
      .locator('[aria-label="Account"], [aria-label*="profile" i]')
      .first()
      .click()
      .then(() => true)
      .catch(() => false);
    if (menuOpened) {
      try {
        const menu = page.locator('[role="menu"]:visible, [role="dialog"]:visible').last();
        await menu.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
        const links = await menu
          .locator('a[href*="facebook.com/"]')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              name: (element.textContent ?? "").trim(),
              href: (element as HTMLAnchorElement).href,
            }))
          )
          .catch(() => [] as Array<{ name: string; href: string }>);
        for (const link of links) {
          const entity = facebookEntityFromLink(link);
          if (!entity) continue;
          discovered.set(entity.handle.toLowerCase(), entity);
        }
      } finally {
        await page.keyboard.press("Escape").catch(() => undefined);
      }
    }

    return [...discovered.values()].map((item, index) => ({
      platform: "facebook" as const,
      kind: index === 0 && item.handle === current ? ("profile" as const) : ("page" as const),
      name: item.name,
      handle: item.handle,
      canonicalUrl: item.handle?.startsWith("id:")
        ? `https://www.facebook.com/profile.php?id=${item.handle.slice(3)}`
        : item.handle
          ? `https://www.facebook.com/${item.handle}`
          : null,
      capabilities: defaultTargetCapabilities("facebook"),
    }));
  },

  async verify(page, target) {
    return verifyDetectedTarget("facebook", page, target);
  },

  async activate(page, target) {
    const before = await verifyDetectedTarget("facebook", page, target);
    if (before.active) return { ...before, switched: false };

    await page
      .locator('[aria-label="Account"], [aria-label*="profile" i]')
      .first()
      .click();
    await page.getByText(targetLabel(target), { exact: false }).last().click();
    await page.waitForTimeout(1_000);
    return { ...(await verifyDetectedTarget("facebook", page, target)), switched: true };
  },
};
