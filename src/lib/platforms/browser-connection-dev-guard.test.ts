import { afterEach, describe, expect, it, vi } from "vitest";
import { createRtxBrowserSession, startRtxBrowserSession } from "@/lib/rtx/browser-sessions";
import { openPlatformBrowserSession } from "@/lib/platforms/browser-connection";

// The RTX layer is stubbed so this proves openRtxPlatformTab's own guard, independently of the
// guard inside create/start (which browser-sessions.test.ts covers).
vi.mock("@/lib/rtx/browser-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rtx/browser-sessions")>()),
  createRtxBrowserSession: vi.fn(async () => ({ success: true })),
  startRtxBrowserSession: vi.fn(async () => ({ success: true })),
}));

vi.mock("playwright", () => ({ chromium: { connectOverCDP: vi.fn() } }));

const RTX_ENV = { RTX_APP_ID: "app-1", SERVER_URL: "http://127.0.0.1:3001" };

describe("openRtxPlatformTab on a Dev instance (ADR-541-5)", () => {
  afterEach(() => {
    vi.mocked(createRtxBrowserSession).mockClear();
    vi.mocked(startRtxBrowserSession).mockClear();
  });

  it("refuses the signals-publish tab before registering or starting the session", async () => {
    await expect(
      openPlatformBrowserSession("x", { ...RTX_ENV, SIGNALS_INSTANCE: "dev" }, vi.fn() as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: "DEV_INSTANCE_GUARD", effect: "browser-session.publish" });
    expect(createRtxBrowserSession).not.toHaveBeenCalled();
    expect(startRtxBrowserSession).not.toHaveBeenCalled();
  });

  it("opens the tab unchanged on a canonical instance", async () => {
    await expect(
      openPlatformBrowserSession("x", RTX_ENV, vi.fn() as unknown as typeof fetch),
    ).resolves.toEqual({ sessionName: "signals-publish", opened: true });
    expect(createRtxBrowserSession).toHaveBeenCalledTimes(1);
    expect(startRtxBrowserSession).toHaveBeenCalledWith(
      { sessionName: "signals-publish", url: expect.stringContaining("x.com") },
      expect.anything(),
      expect.anything(),
    );
  });
});
