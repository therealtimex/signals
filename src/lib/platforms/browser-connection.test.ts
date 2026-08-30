import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  findRtxBrowserSession,
  resolveRtxDebugPort,
  listRtxBrowserSessions,
} from "@/lib/rtx/browser-sessions";
import {
  buildPublishSessionAllowedOrigins,
  buildPublishSessionGuardrails,
  buildSocialPlatformConnectionPayload,
  detectPlatformHandle,
  extractFacebookProfileSlugFromUrl,
  extractLinkedInVanityFromUrl,
  extractXHandleFromProfileHref,
  formatFacebookHandle,
  formatLinkedInHandle,
  isFacebookLoggedInUrl,
  isFacebookLoggedOutUrl,
  isLinkedInLoggedInUrl,
  isLinkedInLoggedOutUrl,
  isOAuthConnected,
  isSessionAccountConnected,
  isXLoggedInUrl,
  isXLoggedOutUrl,
  openPlatformBrowserSession,
  probePlatformLogin,
  urlMatchesPlatformHost,
  validatePlatformBrowserSession,
} from "@/lib/platforms/browser-connection";
import type { PlatformSessionStatus } from "@/lib/platforms/browser-connection";
import { createPlatformAccount } from "@/lib/db/queries/platform-accounts";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

describe("rtx browser session helpers", () => {
  it("matches platform hostnames without substring false positives", () => {
    expect(urlMatchesPlatformHost("https://x.com/home", "x.com")).toBe(true);
    expect(urlMatchesPlatformHost("https://www.x.com/home", "x.com")).toBe(true);
    expect(urlMatchesPlatformHost("https://netflix.com/browse", "x.com")).toBe(false);
    expect(urlMatchesPlatformHost("https://www.linkedin.com/feed/", "linkedin.com")).toBe(
      true
    );
  });

  it("does not treat public LinkedIn profile URLs as authentication evidence", () => {
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/feed/")).toBe(true);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/in/jane-doe")).toBe(false);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/login")).toBe(false);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/checkpoint/challenge")).toBe(
      false
    );
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/authwall?trk=foo")).toBe(false);
  });

  it("detects logged-out LinkedIn and X URLs", () => {
    expect(isLinkedInLoggedOutUrl("https://www.linkedin.com/")).toBe(true);
    expect(isLinkedInLoggedOutUrl("https://www.linkedin.com/authwall")).toBe(true);
    expect(isLinkedInLoggedOutUrl("https://www.linkedin.com/in/jane-doe")).toBe(false);
    expect(isXLoggedOutUrl("https://x.com/")).toBe(true);
    expect(isXLoggedOutUrl("https://x.com/login")).toBe(true);
    expect(isXLoggedOutUrl("https://x.com/trung_rta")).toBe(false);
  });

  it("detects authenticated X URLs from profile and home paths", () => {
    expect(isXLoggedInUrl("https://x.com/home")).toBe(true);
    expect(isXLoggedInUrl("https://x.com/brandhandle")).toBe(true);
    expect(isXLoggedInUrl("https://x.com/login")).toBe(false);
    expect(isXLoggedInUrl("https://x.com/i/flow/login")).toBe(false);
    expect(isXLoggedInUrl("https://x.com/")).toBe(false);
  });

  it("extracts platform handles from profile URLs and hrefs", () => {
    expect(extractLinkedInVanityFromUrl("https://www.linkedin.com/in/jane-doe?trk=foo")).toBe(
      "jane-doe"
    );
    expect(formatLinkedInHandle("jane-doe")).toBe("/in/jane-doe");
    expect(extractXHandleFromProfileHref("/brandhandle")).toBe("@brandhandle");
    expect(extractXHandleFromProfileHref("/home")).toBe(null);
    expect(extractXHandleFromProfileHref("/brand/status/123")).toBe(null);
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/jane.doe")).toBe(
      "jane.doe"
    );
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/profile.php?id=12345")).toBe(
      "id:12345"
    );
    expect(formatFacebookHandle("jane.doe")).toBe("jane.doe");
  });

  it("detects authenticated Facebook URLs without vanity profile false positives", () => {
    expect(isFacebookLoggedInUrl("https://www.facebook.com/home")).toBe(true);
    expect(isFacebookLoggedInUrl("https://www.facebook.com/messages")).toBe(true);
    expect(isFacebookLoggedInUrl("https://www.facebook.com/zuck")).toBe(false);
    expect(isFacebookLoggedInUrl("https://www.facebook.com/")).toBe(false);
    expect(isFacebookLoggedInUrl("https://www.facebook.com/watch")).toBe(false);
    expect(isFacebookLoggedOutUrl("https://www.facebook.com/")).toBe(false);
    expect(isFacebookLoggedOutUrl("https://www.facebook.com/login")).toBe(true);
    expect(isFacebookLoggedOutUrl("https://www.facebook.com/login/?next=foo")).toBe(true);
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/profile.php")).toBe(null);
  });

  it("treats Facebook .php endpoints as app pages, not profiles", () => {
    // The logged-in feed is served at /home.php; reading it as a vanity profile
    // suppressed the logged-in verdict and leaked "home.php" as a handle (#184).
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/home.php")).toBe(null);
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/index.php")).toBe(null);
    expect(isFacebookLoggedInUrl("https://www.facebook.com/home.php")).toBe(true);
    expect(isFacebookLoggedOutUrl("https://www.facebook.com/home.php")).toBe(false);
    expect(extractFacebookProfileSlugFromUrl("https://www.facebook.com/jane.doe")).toBe(
      "jane.doe"
    );
  });

  it("finds a session case-insensitively", () => {
    const entry = findRtxBrowserSession(
      [{ sessionName: "signals-publish", running: true }],
      "Signals-Publish"
    );
    expect(entry?.sessionName).toBe("signals-publish");
  });

  it("resolves debug port from runtime fields", () => {
    expect(
      resolveRtxDebugPort({
        sessionName: "signals-publish",
        runtime: { remoteDebugPort: 9223 },
      })
    ).toBe(9223);
    expect(
      resolveRtxDebugPort({
        sessionName: "signals-publish",
        runtime: { port: 9333 },
      })
    ).toBe(9333);
  });

  it("lists sessions via RTX CLI", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        sessions: [{ sessionName: "signals-publish", running: false }],
      }),
    });

    const sessions = await listRtxBrowserSessions(
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      fetchImpl as unknown as typeof fetch
    );

    expect(sessions).toEqual([{ sessionName: "signals-publish", running: false }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/cli/list-browser-sessions?includeReservedSessions=true",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("browser connection status", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  it("treats oauth rows as connected only with encrypted credentials", () => {
    expect(isOAuthConnected(undefined)).toBe(false);
    expect(
      isOAuthConnected({
        id: "1",
        platform: "x",
        displayName: "@test",
        authType: "oauth",
        credentialsEncrypted: "enc",
        status: "active",
        lastSyncedAt: null,
        createdAt: 1,
        updatedAt: 1,
        metadata: null,
        rateLimitState: null,
      })
    ).toBe(true);
  });

  it("does not treat a running RTX session alone as connected", () => {
    const sessionStatus: PlatformSessionStatus = {
      mode: "rtx",
      hasSession: true,
      sessionRunning: true,
      lastValidatedAt: null,
      detectedHandle: null,
      sessionName: "signals-publish",
    };

    expect(isSessionAccountConnected(undefined, sessionStatus)).toBe(false);
  });

  it("marks session accounts connected when validated", () => {
    const sessionStatus: PlatformSessionStatus = {
      mode: "rtx",
      hasSession: true,
      sessionRunning: true,
      lastValidatedAt: null,
      detectedHandle: null,
      sessionName: "signals-publish",
    };

    expect(
      isSessionAccountConnected(
        {
          id: "1",
          platform: "x",
          displayName: "@brand",
          authType: "session",
          credentialsEncrypted: null,
          status: "active",
          lastSyncedAt: null,
          createdAt: 1,
          updatedAt: 1,
          metadata: null,
          rateLimitState: null,
        },
        sessionStatus
      )
    ).toBe(true);
  });

  it("reports session present but not connected until validated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        sessions: [{ sessionName: "signals-publish", running: true }],
      }),
    });

    const payload = await buildSocialPlatformConnectionPayload(
      "x",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      fetchImpl as unknown as typeof fetch
    );

    expect(payload.connected).toBe(false);
    expect(payload.connectionVia).toBe(null);
    expect(payload.hasBrowserSession).toBe(true);
    expect(payload.oauthConnected).toBe(false);
  });

  it("builds connected payload after session account is validated", async () => {
    createPlatformAccount({
      platform: "x",
      displayName: "@brand",
      authType: "session",
      credentialsEncrypted: null,
      status: "active",
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        sessions: [{ sessionName: "signals-publish", running: true }],
      }),
    });

    const payload = await buildSocialPlatformConnectionPayload(
      "x",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      fetchImpl as unknown as typeof fetch
    );

    expect(payload.connected).toBe(true);
    expect(payload.connectionVia).toBe("browser");
    expect(payload.hasBrowserSession).toBe(true);
    expect(payload.oauthConnected).toBe(false);
  });

  it("builds Facebook connected payload with browser semantics only", async () => {
    createPlatformAccount({
      platform: "facebook",
      displayName: "jane.doe",
      authType: "session",
      credentialsEncrypted: null,
      status: "active",
      lastSyncedAt: 1_700_000_000,
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        sessions: [{ sessionName: "signals-publish", running: true }],
      }),
    });

    const payload = await buildSocialPlatformConnectionPayload(
      "facebook",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      fetchImpl as unknown as typeof fetch
    );

    expect(payload.connected).toBe(true);
    expect(payload.connectionVia).toBe("browser");
    expect(payload.oauthConnected).toBe(false);
    expect(payload.account?.displayName).toBe("jane.doe");
  });

  it("labels OAuth accounts separately when RTX session is running", async () => {
    createPlatformAccount({
      platform: "x",
      displayName: "@oauth-user",
      authType: "oauth",
      credentialsEncrypted: "enc",
      status: "active",
      lastSyncedAt: 1_700_000_000,
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        sessions: [{ sessionName: "signals-publish", running: true }],
      }),
    });

    const payload = await buildSocialPlatformConnectionPayload(
      "x",
      { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" },
      fetchImpl as unknown as typeof fetch
    );

    expect(payload.oauthConnected).toBe(true);
    expect(payload.connectionVia).toBe("oauth");
    expect(payload.connected).toBe(true);
  });
});

describe("publish session guardrails", () => {
  const RTX_ENV = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" };

  type CliCall = { url: string; body: Record<string, unknown> | null };

  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    vi.mocked(chromium.connectOverCDP).mockReset();
  });

  /** Minimal stand-in for a CDP page: URL, selector visibility, and hrefs. */
  function fakePage(
    url: string,
    { visible = [] as string[], hrefs = {} as Record<string, string> } = {}
  ) {
    return {
      url: () => url,
      locator: (selector: string) => ({
        first: () => ({
          isVisible: async () => visible.includes(selector),
          getAttribute: async () => hrefs[selector] ?? null,
        }),
      }),
    };
  }

  /**
   * Stand-in for the RealTimeX Browser over CDP: tabs it already owns are
   * visible, but a client cannot create one — the case that broke cold validate.
   */
  function fakeBrowser(pages: ReturnType<typeof fakePage>[]) {
    const open = [...pages];
    const browser = {
      contexts: () => [
        {
          pages: () => open,
          newPage: async () => {
            throw new Error("RealTimeX Browser does not allow CDP page creation");
          },
        },
      ],
      newContext: async () => {
        throw new Error("RealTimeX Browser does not allow CDP context creation");
      },
      close: async () => undefined,
    };

    vi.mocked(chromium.connectOverCDP).mockResolvedValue(
      browser as unknown as Awaited<ReturnType<typeof chromium.connectOverCDP>>
    );
    return { open };
  }

  /** Mock the RTX CLI: list returns `sessions`, every other call succeeds. */
  function mockRtxCli(sessions: unknown[]) {
    const calls: CliCall[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes("/cli/list-browser-sessions")) {
        return { ok: true, json: async () => ({ success: true, sessions }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    const find = (fragment: string) => calls.find((call) => call.url.includes(fragment));
    return { fetchImpl, calls, find };
  }

  it("derives the allowlist from the platform registry", () => {
    expect(buildPublishSessionAllowedOrigins()).toEqual([
      "https://x.com",
      "https://www.linkedin.com",
      "https://www.facebook.com",
    ]);
    expect(buildPublishSessionGuardrails()).toEqual({
      mode: "unrestricted",
      allowedOrigins: [
        "https://x.com",
        "https://www.linkedin.com",
        "https://www.facebook.com",
      ],
      blockedOrigins: [],
    });
  });

  it("opens a focused platform tab even when the session already runs", async () => {
    const { fetchImpl, find } = mockRtxCli([
      { sessionName: "signals-publish", running: true, remoteDebugPort: 9223 },
    ]);

    const result = await openPlatformBrowserSession(
      "linkedin",
      RTX_ENV,
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({ sessionName: "signals-publish", opened: true });
    // Guardrails are re-declared on every connect so an anchored session migrates
    // in place; no `url` here, or RTX would open a second tab for it.
    expect(find("/cli/create-browser-session")?.body).toEqual({
      sessionName: "signals-publish",
      guardrails: buildPublishSessionGuardrails(),
    });
    expect(find("/cli/start-browser-session/signals-publish")?.body).toEqual({
      url: "https://www.linkedin.com/login",
    });
  });

  it("validates a warm Facebook tab without requesting another", async () => {
    const { fetchImpl, calls, find } = mockRtxCli([
      { sessionName: "signals-publish", running: true, remoteDebugPort: 9223 },
    ]);
    // The logged-in feed is served at /home.php — QA saw this read as logged out.
    fakeBrowser([fakePage("https://www.facebook.com/home.php")]);

    const result = await validatePlatformBrowserSession(
      "facebook",
      RTX_ENV,
      fetchImpl as unknown as typeof fetch
    );

    expect(result.isValid).toBe(true);
    expect(find("/cli/create-browser-session")?.body).toEqual({
      sessionName: "signals-publish",
      guardrails: buildPublishSessionGuardrails(),
    });
    // A tab already exists, so validate must not open one.
    expect(
      calls.filter((call) => call.url.includes("/cli/start-browser-session/"))
    ).toEqual([]);
  });

  it("detects login from a later marker when an earlier one is not visible", async () => {
    const { fetchImpl } = mockRtxCli([
      { sessionName: "signals-publish", running: true, remoteDebugPort: 9223 },
    ]);
    // Root URL gives no verdict, so the DOM markers decide. Probing selectors one
    // at a time is what makes the later match reachable.
    fakeBrowser([
      fakePage("https://www.facebook.com/", {
        visible: ['[aria-label="Your profile"]'],
      }),
    ]);

    const result = await validatePlatformBrowserSession(
      "facebook",
      RTX_ENV,
      fetchImpl as unknown as typeof fetch
    );

    expect(result.isValid).toBe(true);
  });

  it("rejects a public LinkedIn profile URL as the authenticated session identity", async () => {
    const page = fakePage("https://www.linkedin.com/in/alice");

    await expect(probePlatformLogin("linkedin", page as never, 0)).resolves.toBe(false);
    await expect(
      detectPlatformHandle("linkedin", page as never, page.url()),
    ).resolves.toBe(null);
  });

  it("reads LinkedIn identity only from authenticated navigation, not the viewed profile", async () => {
    const page = fakePage("https://www.linkedin.com/in/alice", {
      visible: [".global-nav__me"],
      hrefs: { '.global-nav__me a[href*="/in/"]': "/in/session-owner" },
    });

    await expect(probePlatformLogin("linkedin", page as never, 0)).resolves.toBe(true);
    await expect(
      detectPlatformHandle("linkedin", page as never, page.url()),
    ).resolves.toBe("/in/session-owner");
  });

  it("requests a platform tab when the session has none, then validates", async () => {
    const { fetchImpl, calls, find } = mockRtxCli([
      { sessionName: "signals-publish", running: true, remoteDebugPort: 9223 },
    ]);
    const { open } = fakeBrowser([]);

    // RTX opens the tab; a CDP client cannot, which is why cold validate failed.
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.includes("/cli/list-browser-sessions")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            sessions: [
              { sessionName: "signals-publish", running: true, remoteDebugPort: 9223 },
            ],
          }),
        };
      }
      if (url.includes("/cli/start-browser-session/") && body?.url) {
        open.push(
          fakePage("https://www.linkedin.com/feed/", {
            visible: [".global-nav__me"],
            hrefs: { 'a.global-nav__primary-link[href*="/in/"]': "/in/jane-doe" },
          })
        );
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    const result = await validatePlatformBrowserSession(
      "linkedin",
      RTX_ENV,
      fetchImpl as unknown as typeof fetch
    );

    expect(result.isValid).toBe(true);
    expect(result.detectedHandle).toBe("/in/jane-doe");
    expect(find("/cli/create-browser-session")?.body).toEqual({
      sessionName: "signals-publish",
      guardrails: buildPublishSessionGuardrails(),
    });
    // Home page, not the login page: a login URL would read as logged out.
    expect(
      calls
        .filter((call) => call.url.includes("/cli/start-browser-session/"))
        .map((call) => call.body)
    ).toEqual([{ url: "https://www.linkedin.com/feed/" }]);
  });

  it("explains guardrail denials with a recovery step", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/cli/list-browser-sessions")) {
        return { ok: true, json: async () => ({ success: true, sessions: [] }) };
      }
      if (url.includes("/cli/start-browser-session/")) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            success: false,
            reason: "guardrail-origin-mismatch",
            error: "The RealTimeX Browser session is locked to https://x.com.",
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    await expect(
      openPlatformBrowserSession(
        "linkedin",
        RTX_ENV,
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/locked to https:\/\/x\.com\..*signals-publish/s);
  });
});
