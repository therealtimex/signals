import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findRtxBrowserSession,
  resolveRtxDebugPort,
  listRtxBrowserSessions,
} from "@/lib/rtx/browser-sessions";
import {
  buildSocialPlatformConnectionPayload,
  extractLinkedInVanityFromUrl,
  extractXHandleFromProfileHref,
  formatLinkedInHandle,
  isLinkedInLoggedInUrl,
  isOAuthConnected,
  isSessionAccountConnected,
  isXLoggedInUrl,
  urlMatchesPlatformHost,
} from "@/lib/platforms/browser-connection";
import type { PlatformSessionStatus } from "@/lib/platforms/browser-connection";
import { createPlatformAccount } from "@/lib/db/queries/platform-accounts";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { resetCoreTables } from "@/test/db";

describe("rtx browser session helpers", () => {
  it("matches platform hostnames without substring false positives", () => {
    expect(urlMatchesPlatformHost("https://x.com/home", "x.com")).toBe(true);
    expect(urlMatchesPlatformHost("https://www.x.com/home", "x.com")).toBe(true);
    expect(urlMatchesPlatformHost("https://netflix.com/browse", "x.com")).toBe(false);
    expect(urlMatchesPlatformHost("https://www.linkedin.com/feed/", "linkedin.com")).toBe(
      true
    );
  });

  it("detects authenticated LinkedIn URLs including profile pages", () => {
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/feed/")).toBe(true);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/in/jane-doe")).toBe(true);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/login")).toBe(false);
    expect(isLinkedInLoggedInUrl("https://www.linkedin.com/checkpoint/challenge")).toBe(
      false
    );
  });

  it("detects authenticated X URLs from profile and home paths", () => {
    expect(isXLoggedInUrl("https://x.com/home")).toBe(true);
    expect(isXLoggedInUrl("https://x.com/brandhandle")).toBe(true);
    expect(isXLoggedInUrl("https://x.com/login")).toBe(false);
    expect(isXLoggedInUrl("https://x.com/i/flow/login")).toBe(false);
  });

  it("extracts platform handles from profile URLs and hrefs", () => {
    expect(extractLinkedInVanityFromUrl("https://www.linkedin.com/in/jane-doe?trk=foo")).toBe(
      "jane-doe"
    );
    expect(formatLinkedInHandle("jane-doe")).toBe("/in/jane-doe");
    expect(extractXHandleFromProfileHref("/brandhandle")).toBe("@brandhandle");
    expect(extractXHandleFromProfileHref("/home")).toBe(null);
    expect(extractXHandleFromProfileHref("/brand/status/123")).toBe(null);
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
