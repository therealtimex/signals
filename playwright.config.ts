import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3456";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `node scripts/start-e2e-server.mjs`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: port,
          E2E_FRESH_DB: process.env.E2E_FRESH_DB ?? "1",
          SIGNALS_DATA_DIR:
            process.env.SIGNALS_DATA_DIR ??
            `${process.cwd()}/.ci/signals-e2e`,
        },
      },
});
