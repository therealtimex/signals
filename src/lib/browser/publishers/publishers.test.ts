import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { clearSession } from "@/lib/browser/session";
import { publishToLinkedIn } from "@/lib/browser/publishers/linkedin-publisher";
import { publishToX } from "@/lib/browser/publishers/x-publisher";
import type { PublishRequest } from "@/lib/browser/publishers/types";

// Nothing in this suite may open a real browser.
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => {
      throw new Error("test must not launch a browser");
    }),
    launchPersistentContext: vi.fn(async () => {
      throw new Error("test must not launch a browser");
    }),
  },
}));

const publishers = [
  ["publishToX", publishToX, "x"],
  ["publishToLinkedIn", publishToLinkedIn, "linkedin"],
] as const;

function request(platform: "x" | "linkedin"): PublishRequest {
  return { platform, mode: "auto", text: "hello" };
}

describe("Playwright publishers on a Dev instance (ADR-541-5)", () => {
  beforeEach(() => {
    vi.mocked(chromium.launch).mockClear();
    vi.mocked(chromium.launchPersistentContext).mockClear();
    clearSession("x");
    clearSession("linkedin");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(publishers)(
    "%s throws DEV_INSTANCE_GUARD instead of returning a publish result",
    async (_name, publish, platform) => {
      vi.stubEnv("SIGNALS_INSTANCE", "dev");

      await expect(publish(request(platform))).rejects.toMatchObject({
        code: "DEV_INSTANCE_GUARD",
        effect: "publish.browser",
      });
      expect(chromium.launchPersistentContext).not.toHaveBeenCalled();
      expect(chromium.launch).not.toHaveBeenCalled();
    },
  );

  it.each(publishers)(
    "%s keeps its canonical failure contract when no session is stored",
    async (_name, publish, platform) => {
      await expect(publish(request(platform))).resolves.toMatchObject({
        success: false,
        errorCode: "session_expired",
      });
      expect(chromium.launchPersistentContext).not.toHaveBeenCalled();
    },
  );
});
