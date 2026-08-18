import { describe, expect, it, vi } from "vitest";
import {
  findRtxBrowserSession,
  resolveRtxDebugPort,
  listRtxBrowserSessions,
} from "@/lib/rtx/browser-sessions";
import {
  buildSocialPlatformConnectionPayload,
  isOAuthConnected,
  isSessionAccountConnected,
} from "@/lib/platforms/browser-connection";
import type { PlatformSessionStatus } from "@/lib/platforms/browser-connection";

describe("rtx browser session helpers", () => {
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

  it("marks session accounts connected when RTX session exists", () => {
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

  it("builds connected payload from RTX session without oauth", async () => {
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
});
