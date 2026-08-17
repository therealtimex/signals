import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/lib/db/client";
import { platformAccounts } from "@/lib/db/schema";
import { ensureXPlatformAccount } from "@/lib/browser/rtx-publish/ensure-platform-account";
import { executeXPublishRtx } from "@/lib/browser/rtx-publish/x-publish-executor";
import { PublishError } from "@/lib/browser/publishers/types";
import { resetCoreTables } from "@/test/db";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import type { BrowserSessionApiClient } from "@/lib/browser/rtx-publish/browser-session-client";

const mockPrepareLoggedIn = vi.fn();
const mockAutoPublish = vi.fn();
const mockReviewPublish = vi.fn();

vi.mock("@/lib/browser/rtx-publish/x-publish-steps", () => ({
  prepareLoggedInXPage: (...args: unknown[]) => mockPrepareLoggedIn(...args),
  runXAutoPublishSteps: (...args: unknown[]) => mockAutoPublish(...args),
  runXReviewPublishSteps: (...args: unknown[]) => mockReviewPublish(...args),
}));

vi.mock("@/lib/browser/rtx-publish/connect", () => ({
  connectToXContentPage: vi.fn(async () => ({
    browser: { close: vi.fn(async () => {}) },
    page: { goto: vi.fn(async () => {}) },
  })),
}));

vi.mock("@/lib/browser/rtx-publish/desktop-browser-client", () => ({
  createDesktopBrowserApiClient: vi.fn(() => ({
    listSessions: vi.fn(async () => ({ success: true, sessions: [] })),
    evaluateTab: vi.fn(),
    focusTab: vi.fn(),
  })),
  findPublishSessionRecord: vi.fn(() => null),
  parseXContentTabsFromSession: vi.fn(() => []),
}));

function createMockApi(): BrowserSessionApiClient {
  return {
    listSessions: vi.fn(async () => [
      { sessionName: "signals-publish", remoteDebugPort: 9333, running: true },
    ]),
    createSession: vi.fn(async () => ({})),
    startSession: vi.fn(async () => ({})),
    stopSession: vi.fn(async () => {}),
  };
}

describe("ensureXPlatformAccount", () => {
  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
  });

  it("creates session-type account when missing", () => {
    const account = ensureXPlatformAccount("@founder");
    expect(account.platform).toBe("x");
    expect(account.authType).toBe("session");
    expect(account.displayName).toBe("@founder");
  });
});

describe("executeXPublishRtx", () => {
  const embeddedEnv = { RTX_APP_ID: "signals-app", SERVER_URL: "http://127.0.0.1:3001" };

  beforeEach(() => {
    resetCoreTables();
    db.delete(platformAccounts).run();
    mockPrepareLoggedIn.mockReset();
    mockAutoPublish.mockReset();
    mockReviewPublish.mockReset();
  });

  it("uses x-app-id browser session API in embedded mode", async () => {
    mockPrepareLoggedIn.mockResolvedValue("@founder");
    mockAutoPublish.mockResolvedValue({
      success: true,
      platformUrl: "https://x.com/founder/status/1",
      platformPostId: "1",
    });

    const api = createMockApi();
    const result = await executeXPublishRtx(
      { platform: "x", mode: "auto", text: "hello" },
      { env: embeddedEnv, browserSessionApi: api }
    );

    expect(result.success).toBe(true);
    expect(api.listSessions).toHaveBeenCalled();
    expect(api.stopSession).toHaveBeenCalled();
    expect(getPlatformAccountByPlatform("x")?.displayName).toBe("@founder");
  });

  it("does not stop the browser session when auto publish fails", async () => {
    mockPrepareLoggedIn.mockRejectedValue(
      new PublishError("not logged in", "session_expired")
    );

    const api = createMockApi();
    const result = await executeXPublishRtx(
      { platform: "x", mode: "auto", text: "hello" },
      { env: embeddedEnv, browserSessionApi: api }
    );

    expect(result.success).toBe(false);
    expect(api.stopSession).not.toHaveBeenCalled();
  });

  it("does not create a platform account when login validation fails", async () => {
    mockPrepareLoggedIn.mockRejectedValue(
      new PublishError("not logged in", "session_expired")
    );

    const result = await executeXPublishRtx(
      { platform: "x", mode: "auto", text: "hello" },
      { env: embeddedEnv, browserSessionApi: createMockApi() }
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("session_expired");
    expect(getPlatformAccountByPlatform("x")).toBeUndefined();
  });

  it("rejects standalone mode without CDP override", async () => {
    const result = await executeXPublishRtx({
      platform: "x",
      mode: "auto",
      text: "hello",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("session_expired");
  });

  it("returns failure when verification does not find the post", async () => {
    mockPrepareLoggedIn.mockResolvedValue("@founder");
    mockReviewPublish.mockResolvedValue({
      success: false,
      error: "Compose closed without detecting a newly published post. You may have canceled or navigated away.",
      errorCode: "unknown",
    });

    const result = await executeXPublishRtx(
      { platform: "x", mode: "review", text: "hello" },
      { env: embeddedEnv, browserSessionApi: createMockApi() }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Compose closed without detecting");
  });
});
