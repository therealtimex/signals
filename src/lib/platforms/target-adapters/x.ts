import { X_SELECTORS } from "@/lib/publish/x-browser/x-publish-selectors";
import { detectPlatformHandle } from "@/lib/platforms/browser-connection";
import { defaultTargetCapabilities } from "@/lib/platforms/target-identity";
import { targetLabel, verifyDetectedTarget } from "@/lib/platforms/target-adapters/shared";
import type { PlatformTargetAdapter } from "@/lib/platforms/target-adapters/types";

export const xTargetAdapter: PlatformTargetAdapter = {
  async discover(page) {
    const handles = new Set<string>();
    const detected = await detectPlatformHandle("x", page, page.url()).catch(() => null);
    if (detected) handles.add(detected);
    const current = await page
      .locator(X_SELECTORS.accountSwitcher)
      .getAttribute("aria-label")
      .then((label) => label?.match(/@[\w.]+/g) ?? [])
      .catch(() => [] as string[]);
    current.forEach((handle) => handles.add(handle));

    await page.locator(X_SELECTORS.accountSwitcher).click().catch(() => undefined);
    const menu = page.locator('[role="menu"]');
    await menu.first().waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
    const switcherText = await menu
      .allInnerTexts()
      .then((values) => values.join("\n"))
      .catch(() => "");
    switcherText.match(/@[\w.]+/g)?.forEach((handle) => handles.add(handle));
    await page.keyboard.press("Escape").catch(() => undefined);

    return [...handles].map((handle) => ({
      platform: "x" as const,
      kind: "account" as const,
      name: handle,
      handle,
      canonicalUrl: `https://x.com/${handle.slice(1)}`,
      capabilities: defaultTargetCapabilities("x"),
    }));
  },

  async verify(page, target) {
    return verifyDetectedTarget("x", page, target);
  },

  async activate(page, target) {
    const before = await verifyDetectedTarget("x", page, target);
    if (before.active) return { ...before, switched: false };

    await page.locator(X_SELECTORS.accountSwitcher).click();
    const label = targetLabel(target);
    const option = page.getByText(label, { exact: false }).last();
    await option.click();
    await page.waitForTimeout(1_000);
    return { ...(await verifyDetectedTarget("x", page, target)), switched: true };
  },
};
