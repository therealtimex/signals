import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  clearSession,
  hasSession,
  loadSession,
  saveSession,
  setupSession,
  validateSession,
} from "@/lib/browser/session";
import type { BrowserSession } from "@/lib/browser/types";

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

function storedSession(): BrowserSession {
  return {
    platform: "x",
    cookies: [],
    userAgent: "test-agent",
    viewport: { width: 1280, height: 800 },
    createdAt: 100,
    lastValidatedAt: 200,
  };
}

describe("legacy Playwright publish session on a Dev instance (ADR-541-5)", () => {
  beforeEach(() => {
    vi.mocked(chromium.launch).mockClear();
    vi.mocked(chromium.launchPersistentContext).mockClear();
    clearSession("x");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearSession("x");
  });

  it("refuses to load a stored session, even one that exists", () => {
    saveSession(storedSession());
    vi.stubEnv("SIGNALS_INSTANCE", "dev");

    expect(() => loadSession("x")).toThrow(
      expect.objectContaining({ code: "DEV_INSTANCE_GUARD", effect: "publish.browser" }),
    );
    // Existence stays observable; only the cookies are withheld.
    expect(hasSession("x")).toBe(true);
  });

  it("refuses setup before a browser is launched", async () => {
    vi.stubEnv("SIGNALS_INSTANCE", "dev");

    await expect(setupSession("x")).rejects.toMatchObject({
      code: "DEV_INSTANCE_GUARD",
      effect: "publish.browser",
    });
    expect(chromium.launchPersistentContext).not.toHaveBeenCalled();
  });

  it("refuses validation, which would replay the stored cookies, before a browser is launched", async () => {
    saveSession(storedSession());
    vi.stubEnv("SIGNALS_INSTANCE", "dev");

    await expect(validateSession("x")).rejects.toMatchObject({ code: "DEV_INSTANCE_GUARD" });
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it("loads the stored session unchanged on a canonical instance", () => {
    expect(loadSession("x")).toBeNull();
    saveSession(storedSession());
    expect(loadSession("x")).toEqual(storedSession());
  });
});
