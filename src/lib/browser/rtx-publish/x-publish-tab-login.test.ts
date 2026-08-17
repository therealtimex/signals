import { describe, expect, it, vi } from "vitest";
import { probeLoggedInXTab } from "@/lib/browser/rtx-publish/x-publish-tab-login";
import type { DesktopBrowserApiClient } from "@/lib/browser/rtx-publish/desktop-browser-client";

describe("probeLoggedInXTab", () => {
  it("returns the first tab that evaluates as logged in", async () => {
    const client: DesktopBrowserApiClient = {
      listSessions: vi.fn(),
      focusTab: vi.fn(async () => ({})),
      evaluateTab: vi
        .fn()
        .mockResolvedValueOnce({ value: { loggedIn: false } })
        .mockResolvedValueOnce({ value: { loggedIn: true, handle: "@founder" } }),
    };

    const result = await probeLoggedInXTab(
      [
        {
          id: 1,
          ref: "cli-browser:9444:tab:1",
          url: "https://x.com/home",
          title: "Home",
          isActive: false,
        },
        {
          id: 2,
          ref: "cli-browser:9444:tab:2",
          url: "https://x.com/home",
          title: "Home",
          isActive: true,
        },
      ],
      client
    );

    expect(result).toEqual({
      tab: expect.objectContaining({ ref: "cli-browser:9444:tab:2" }),
      handle: "@founder",
    });
    expect(client.focusTab).toHaveBeenCalled();
    expect(client.evaluateTab).toHaveBeenCalledTimes(2);
  });
});
