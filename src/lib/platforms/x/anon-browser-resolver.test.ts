import { beforeEach, describe, expect, it, vi } from "vitest";

const playwright = vi.hoisted(() => ({
  launch: vi.fn(),
  connectOverCDP: vi.fn(),
}));
const rtx = vi.hoisted(() => ({
  isEmbedded: vi.fn(() => false),
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  list: vi.fn(),
}));

vi.mock("playwright", () => ({
  chromium: playwright,
}));
vi.mock("@/lib/rtx/env", () => ({ isRtxEmbedded: rtx.isEmbedded }));
vi.mock("@/lib/rtx/browser-sessions", () => ({
  createRtxBrowserSession: rtx.create,
  startRtxBrowserSession: rtx.start,
  stopRtxBrowserSession: rtx.stop,
  listRtxBrowserSessions: rtx.list,
  findRtxBrowserSession: (sessions: Array<{ sessionName: string }>, name: string) =>
    sessions.find((session) => session.sessionName === name),
  resolveRtxDebugPort: (session: { remoteDebugPort?: number } | undefined) =>
    session?.remoteDebugPort ?? null,
}));
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import {
  createAnonHandleResolver,
  shouldAllowXBrowserRequest,
} from "@/lib/platforms/x/anon-browser-resolver";
import { X_ANON_SESSION_NAME } from "@/lib/platforms/x/anon-web-constants";

/** A logged-out standalone Chromium that always lands on https://x.com/tri_dao. */
function standaloneBrowser() {
  let pageUrl = "about:blank";
  const page = {
    route: vi.fn(async () => undefined),
    goto: vi.fn(async (url: string) => { pageUrl = "https://x.com/tri_dao"; return null; }),
    url: vi.fn(() => pageUrl),
    content: vi.fn(async () => '<html><head><meta property="og:title" content="Tri Dao (@tri_dao) on X"></head></html>'),
    waitForLoadState: vi.fn(async () => undefined),
    locator: vi.fn((selector: string) => ({
      first: () => ({
        isVisible: async () => selector === '[data-testid="loginButton"]',
        textContent: async () => null,
      }),
      innerText: async () => "Log in Sign up",
    })),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  return { page, context, browser };
}

describe("anonymous X browser safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rtx.isEmbedded.mockReturnValue(false);
    rtx.create.mockResolvedValue({});
    rtx.start.mockResolvedValue({});
    rtx.stop.mockResolvedValue({});
  });

  it("uses a dedicated session and refuses signals-publish", async () => {
    expect(X_ANON_SESSION_NAME).toBe("signals-x-anon");
    expect(X_ANON_SESSION_NAME).not.toBe(RTX_PUBLISH_SESSION_NAME);
    await expect(createAnonHandleResolver({}, fetch, RTX_PUBLISH_SESSION_NAME)).rejects.toThrow(
      "refuses the connected publish session",
    );
  });

  it("fences browser traffic to X and its static assets", () => {
    expect(shouldAllowXBrowserRequest("https://x.com/i/user/1")).toBe(true);
    expect(shouldAllowXBrowserRequest("https://pbs.twimg.com/a.jpg")).toBe(true);
    expect(shouldAllowXBrowserRequest("https://video.twimg.com/a.mp4")).toBe(true);
    expect(shouldAllowXBrowserRequest("data:image/png;base64,abc")).toBe(true);
    expect(shouldAllowXBrowserRequest("https://evil.example/x.com")).toBe(false);
  });

  it("resolves in a fresh logged-out standalone context and disposes it", async () => {
    const { page, context, browser } = standaloneBrowser();
    playwright.launch.mockResolvedValue(browser);

    const resolver = await createAnonHandleResolver({}, fetch);
    try {
      await expect(resolver.resolve("568879807")).resolves.toEqual({
        status: "resolved",
        handle: "tri_dao",
      });
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: expect.stringContaining("Chrome/") }),
      );
      expect(page.goto).toHaveBeenCalledWith(
        "https://x.com/i/user/568879807",
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
    } finally {
      await resolver.dispose();
    }
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("launches headed with the automation flag suppressed, because X refuses headless", async () => {
    const { browser } = standaloneBrowser();
    playwright.launch.mockResolvedValue(browser);

    const resolver = await createAnonHandleResolver({}, fetch);
    await resolver.dispose();

    expect(playwright.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
        args: expect.arrayContaining(["--disable-blink-features=AutomationControlled"]),
      }),
    );
  });

  it("returns the landed profile markup and refuses a page that redirected elsewhere", async () => {
    const { page, browser } = standaloneBrowser();
    playwright.launch.mockResolvedValue(browser);

    const resolver = await createAnonHandleResolver({}, fetch);
    try {
      await expect(resolver.fetchProfile("tri_dao")).resolves.toMatchObject({
        status: "ok",
        finalUrl: "https://x.com/tri_dao",
        html: expect.stringContaining("og:title"),
      });
      // X redirects a renamed handle to whoever owns it now; that is not the profile we asked for.
      await expect(resolver.fetchProfile("somebody_else")).resolves.toEqual({
        status: "unexpected_redirect",
      });
      expect(page.goto).toHaveBeenCalledWith(
        "https://x.com/somebody_else",
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
    } finally {
      await resolver.dispose();
    }
  });

  it("uses only signals-x-anon for every RTX browser lifecycle call", async () => {
    rtx.isEmbedded.mockReturnValue(true);
    rtx.list.mockResolvedValue([{ sessionName: X_ANON_SESSION_NAME, remoteDebugPort: 9222 }]);
    let pageUrl = "https://x.com/tri_dao";
    const page = {
      route: vi.fn(async () => undefined),
      url: vi.fn(() => pageUrl),
      goto: vi.fn(async () => { pageUrl = "https://x.com/tri_dao"; }),
      locator: vi.fn((selector: string) => ({
        first: () => ({
          isVisible: async () => selector === '[data-testid="loginButton"]',
          textContent: async () => null,
        }),
        innerText: async () => "Log in Sign up",
      })),
    };
    const browser = {
      contexts: () => [{ pages: () => [page] }],
      close: vi.fn(async () => undefined),
    };
    playwright.connectOverCDP.mockResolvedValue(browser);

    const resolver = await createAnonHandleResolver({ RTX_APP_ID: "app-1" }, fetch);
    await expect(resolver.resolve("568879807")).resolves.toEqual({
      status: "resolved",
      handle: "tri_dao",
    });
    await resolver.dispose();

    expect(rtx.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionName: X_ANON_SESSION_NAME }),
      expect.any(Object),
      fetch,
    );
    expect(rtx.start).toHaveBeenCalledWith(
      { sessionName: X_ANON_SESSION_NAME, url: "https://x.com/" },
      expect.any(Object),
      fetch,
    );
    expect(rtx.stop).toHaveBeenCalledWith(X_ANON_SESSION_NAME, expect.any(Object), fetch);
    const sessionArgs = [
      rtx.create.mock.calls[0]?.[0]?.sessionName,
      rtx.start.mock.calls[0]?.[0]?.sessionName,
      rtx.stop.mock.calls[0]?.[0],
    ];
    expect(sessionArgs).toEqual([X_ANON_SESSION_NAME, X_ANON_SESSION_NAME, X_ANON_SESSION_NAME]);
    expect(sessionArgs).not.toContain(RTX_PUBLISH_SESSION_NAME);
  });
});
