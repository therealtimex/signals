import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.SIGNALS_BASE_URL ?? "http://127.0.0.1:3010";
const evidenceDir = join(process.cwd(), ".evidence");
const guideAssetsDir = join(process.cwd(), "guide", "assets");

const targets = [
  { view: "settings-platforms", path: "/dashboard/settings?tab=platforms" },
  { view: "settings-agents", path: "/dashboard/settings?tab=agents" },
];

const formFactors = [
  { label: "desktop", width: 1280, height: 900 },
  { label: "mobile", width: 390, height: 844 },
] ;

const themes = ["light", "dark"];

async function capture(page, filePath) {
  await page.screenshot({ path: filePath, fullPage: true });
}

async function run(browser) {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(guideAssetsDir, { recursive: true });

  for (const theme of themes) {
    for (const formFactor of formFactors) {
      const context = await browser.newContext({
        viewport: { width: formFactor.width, height: formFactor.height },
        colorScheme: theme,
      });
      const page = await context.newPage();

      for (const target of targets) {
        await page.goto(`${baseUrl}${target.path}`, { waitUntil: "networkidle" });
        await page.waitForSelector("h1:text('Settings')");

        const evidenceName = `after_${target.view}_${formFactor.label}_${theme}.png`;
        await capture(page, join(evidenceDir, evidenceName));

        if (formFactor.label === "desktop" && theme === "light") {
          const guideName =
            target.view === "settings-platforms" ? "settings-platforms.png" : "settings-agents.png";
          await capture(page, join(guideAssetsDir, guideName));
        }
      }

      await context.close();
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
