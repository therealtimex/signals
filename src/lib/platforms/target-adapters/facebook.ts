import { detectPlatformHandle } from "@/lib/platforms/browser-connection";
import { defaultTargetCapabilities } from "@/lib/platforms/target-identity";
import { targetLabel, verifyDetectedTarget } from "@/lib/platforms/target-adapters/shared";
import type { PlatformTargetAdapter } from "@/lib/platforms/target-adapters/types";

export const facebookTargetAdapter: PlatformTargetAdapter = {
  async discover(page) {
    const discovered = new Map<string, { name: string; handle: string | null }>();
    const current = await detectPlatformHandle("facebook", page, page.url());
    if (current) discovered.set(current.toLowerCase(), { name: current, handle: current });

    await page
      .locator('[aria-label="Account"], [aria-label*="profile" i]')
      .first()
      .click()
      .catch(() => undefined);
    const links = await page
      .locator('a[href*="facebook.com/"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          name: (element.textContent ?? "").trim(),
          href: (element as HTMLAnchorElement).href,
        }))
      )
      .catch(() => [] as Array<{ name: string; href: string }>);
    for (const link of links) {
      const match = link.href.match(/facebook\.com\/(?:profile\.php\?id=)?([^/?#]+)/i);
      if (!match || !link.name) continue;
      const handle = link.href.includes("profile.php?id=") ? `id:${match[1]}` : match[1];
      discovered.set(handle.toLowerCase(), { name: link.name, handle });
    }
    await page.keyboard.press("Escape").catch(() => undefined);

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
