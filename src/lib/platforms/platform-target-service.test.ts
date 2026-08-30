import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({ activate: vi.fn() }));
const browserMocks = vi.hoisted(() => ({
  detectPlatformHandle: vi.fn(),
  pageUrl: vi.fn(),
  probePlatformLogin: vi.fn(),
}));

vi.mock("@/lib/platforms/target-adapters", () => ({
  getPlatformTargetAdapter: () => ({ activate: adapterMocks.activate }),
}));

vi.mock("@/lib/platforms/browser-connection", () => ({
  detectPlatformHandle: browserMocks.detectPlatformHandle,
  withPlatformBrowserPage: async (
    _platform: string,
    _sessionName: string,
    callback: (page: object) => unknown,
  ) => callback({ url: browserMocks.pageUrl }),
  getPlatformHomeUrl: (platform: string) => `https://www.${platform}.com/`,
  probePlatformLogin: browserMocks.probePlatformLogin,
}));

import {
  ensureBrowserConnection,
  listPlatformTargets,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { getSessionLease } from "@/lib/leases/session-lease";
import {
  prepareCurrentPlatformTarget,
  preparePlatformTarget,
  releasePreparedPlatformTarget,
} from "@/lib/platforms/platform-target-service";
import { resetCoreTables } from "@/test/db";

describe("preparePlatformTarget login classification", () => {
  beforeEach(() => {
    resetCoreTables();
    adapterMocks.activate.mockReset();
    browserMocks.detectPlatformHandle.mockReset();
    browserMocks.pageUrl.mockReset();
    browserMocks.pageUrl.mockReturnValue("https://www.linkedin.com/feed/");
    browserMocks.probePlatformLogin.mockReset();
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

  it("inherits the live signals-publish identity and binds the lease to it", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const stale = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/stale",
      handle: "/in/stale",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    browserMocks.probePlatformLogin.mockResolvedValue(true);
    browserMocks.detectPlatformHandle.mockResolvedValue("/in/live");

    const prepared = await prepareCurrentPlatformTarget({
      platform: "linkedin",
      intent: "browse",
      holder: "contact-web-research:run-live",
      leaseTtlSeconds: 600,
    });

    expect(prepared).toMatchObject({
      platform: "linkedin",
      sessionName: "signals-publish",
      startUrl: "https://www.linkedin.com/in/live",
      expectedHandle: "/in/live",
      verifiedHandle: "/in/live",
      activation: { switched: false },
    });
    expect(prepared.targetId).not.toBe(stale.id);
    expect(listPlatformTargets({ platform: "linkedin" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: stale.id, handle: "/in/stale", isDefault: true }),
        expect.objectContaining({ id: prepared.targetId, handle: "/in/live" }),
      ]),
    );
    expect(getSessionLease(connection.id)).toMatchObject({
      leaseId: prepared.lease.leaseId,
      holder: "contact-web-research:run-live",
      targetId: prepared.targetId,
      intent: "browse",
    });
    releasePreparedPlatformTarget(prepared.lease.leaseId);
  });

  it("fails signed-out inherited sessions and releases their provisional lease", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    browserMocks.probePlatformLogin.mockResolvedValue(false);

    await expect(
      prepareCurrentPlatformTarget({
        platform: "linkedin",
        intent: "browse",
        holder: "contact-web-research:run-signed-out",
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(browserMocks.detectPlatformHandle).not.toHaveBeenCalled();
    expect(getSessionLease(connection.id)).toBeUndefined();
  });

  it("rejects a public LinkedIn profile tab with no authenticated self identity", async () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    browserMocks.pageUrl.mockReturnValue("https://www.linkedin.com/in/alice");
    browserMocks.probePlatformLogin.mockResolvedValue(true);
    browserMocks.detectPlatformHandle.mockResolvedValue(null);

    await expect(
      prepareCurrentPlatformTarget({
        platform: "linkedin",
        intent: "browse",
        holder: "contact-web-research:run-public-profile",
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(browserMocks.detectPlatformHandle).toHaveBeenCalledWith(
      "linkedin",
      expect.anything(),
      "https://www.linkedin.com/in/alice",
    );
    expect(listPlatformTargets({ platform: "linkedin" })).toEqual([]);
    expect(getSessionLease(connection.id)).toBeUndefined();
  });
});
