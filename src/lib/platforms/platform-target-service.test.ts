import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({ activate: vi.fn() }));

vi.mock("@/lib/platforms/target-adapters", () => ({
  getPlatformTargetAdapter: () => ({ activate: adapterMocks.activate }),
}));

vi.mock("@/lib/platforms/browser-connection", () => ({
  withPlatformBrowserPage: async (
    _platform: string,
    _sessionName: string,
    callback: (page: object) => unknown,
  ) => callback({}),
  getPlatformHomeUrl: (platform: string) => `https://www.${platform}.com/`,
}));

import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { getSessionLease } from "@/lib/leases/session-lease";
import { preparePlatformTarget } from "@/lib/platforms/platform-target-service";
import { resetCoreTables } from "@/test/db";

describe("preparePlatformTarget login classification", () => {
  beforeEach(() => {
    resetCoreTables();
    adapterMocks.activate.mockReset();
  });

  it("raises LOGIN_REQUIRED and releases the lease when the adapter reports logged out", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/current",
      handle: "/in/current",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    adapterMocks.activate.mockResolvedValue({
      loggedIn: false,
      active: false,
      detectedHandle: null,
      switched: false,
    });

    await expect(
      preparePlatformTarget({
        targetId: target.id,
        intent: "browse",
        holder: "contact-web-research:run-1",
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(getSessionLease(connection.id)).toBeUndefined();
  });
});
