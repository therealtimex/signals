import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platforms/browser-connection", () => ({
  getPlatformHomeUrl: (platform: string) => `https://${platform}.example/`,
  withPlatformBrowserPage: async (
    _platform: string,
    _sessionName: string,
    callback: (page: object) => Promise<unknown>
  ) => callback({}),
}));

vi.mock("@/lib/platforms/target-adapters", () => ({
  getPlatformTargetAdapter: () => ({
    activate: async () => ({
      loggedIn: true,
      active: true,
      detectedHandle: "@target",
      switched: false,
    }),
  }),
}));

import {
  handleGetPlatformTarget,
  handleListPlatformTargets,
  handlePreparePlatformTarget,
  handleReleasePlatformTarget,
} from "@/lib/agent-tools/platform-target-handlers";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { acquireSessionLease } from "@/lib/leases/session-lease";
import { resetCoreTables } from "@/test/db";

function seedTarget(platform: "x" | "facebook" = "x") {
  const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform,
    kind: platform === "x" ? "account" : "profile",
    name: "Target",
    handle: "@target",
    capabilities: platform === "facebook" ? ["browse"] : ["browse", "publish"],
    source: "test",
  });
  return { connection, target };
}

describe("platform target agent-tool handlers", () => {
  beforeEach(() => resetCoreTables());

  it("lists, gets, prepares, and releases a target with structured context", async () => {
    const { target } = seedTarget();
    const listed = await handleListPlatformTargets({});
    expect(listed.targets).toContainEqual(expect.objectContaining({ id: target.id }));

    expect(await handleGetPlatformTarget({ targetId: target.id })).toMatchObject({
      id: target.id,
      lease: { held: false },
    });
    const prepared = await handlePreparePlatformTarget({
      targetId: target.id,
      intent: "publish",
      holder: "agent-a",
    });
    expect(prepared).toMatchObject({
      targetId: target.id,
      verified: true,
      lease: { leaseId: expect.stringMatching(/^lease_/) },
    });
    if (!("lease" in prepared)) throw new Error("Expected prepared lease");
    expect(await handleReleasePlatformTarget({ leaseId: prepared.lease.leaseId })).toEqual({
      released: true,
    });
  });

  it("returns typed target, capability, and contention errors", async () => {
    expect(await handleGetPlatformTarget({ targetId: "missing" })).toMatchObject({
      code: "TARGET_NOT_FOUND",
    });
    const facebook = seedTarget("facebook");
    expect(
      await handlePreparePlatformTarget({ targetId: facebook.target.id, intent: "publish" })
    ).toMatchObject({ code: "TARGET_CAPABILITY_UNSUPPORTED" });

    acquireSessionLease(facebook.connection.id, { holder: "agent-a" });
    expect(
      await handlePreparePlatformTarget({
        targetId: facebook.target.id,
        intent: "browse",
        holder: "agent-b",
      })
    ).toMatchObject({
      code: "SESSION_LEASE_HELD",
      details: expect.objectContaining({ holder: "agent-a" }),
    });
  });
});
