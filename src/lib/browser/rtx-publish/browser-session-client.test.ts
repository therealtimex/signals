import { describe, expect, it, vi } from "vitest";
import {
  createBrowserSessionApiClient,
  rtxBrowserSessionRequest,
} from "@/lib/browser/rtx-publish/browser-session-client";

describe("rtxBrowserSessionRequest", () => {
  it("sends x-app-id for Local App browser session calls", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, sessions: [] }),
    }));

    await rtxBrowserSessionRequest(
      "/cli/list-browser-sessions",
      { method: "GET" },
      { RTX_APP_ID: "signals-app", SERVER_URL: "http://127.0.0.1:3001" },
      fetchMock as unknown as typeof fetch
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/cli/list-browser-sessions",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-app-id": "signals-app",
        }),
      })
    );
  });

  it("maps HTTP 403 to session_expired PublishError", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "No valid api key found." }),
    }));

    await expect(
      rtxBrowserSessionRequest(
        "/cli/list-browser-sessions",
        { method: "GET" },
        { RTX_APP_ID: "missing-app", SERVER_URL: "http://127.0.0.1:3001" },
        fetchMock as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ errorCode: "session_expired" });
  });
});

describe("createBrowserSessionApiClient", () => {
  it("creates session with optional start URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          created: true,
          session: { sessionName: "signals-publish", remoteDebugPort: 9444 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, sessions: [] }),
      });

    const client = createBrowserSessionApiClient(
      { RTX_APP_ID: "signals-app", SERVER_URL: "http://127.0.0.1:3001" },
      fetchMock as unknown as typeof fetch
    );

    await client.createSession("signals-publish", "https://x.com/home");
    const sessions = await client.listSessions();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3001/cli/create-browser-session"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      sessionName: "signals-publish",
      url: "https://x.com/home",
    });
    expect(sessions).toEqual([]);
  });
});
