import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platformTargetServiceMocks = vi.hoisted(() => ({
  prepareCurrentPlatformTarget: vi.fn(),
  releasePreparedPlatformTarget: vi.fn(),
}));

vi.mock("@/lib/platforms/platform-target-service", () => platformTargetServiceMocks);

import {
  prepareNetworkSnowballTarget,
  releaseNetworkSnowballTarget,
  releaseNetworkSnowballTargetForRun,
  SNOWBALL_BROWSER_TARGET_CONFIG_KEY,
} from "@/lib/workflows/network-snowball-target";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { resetCoreTables } from "@/test/db";
import {
  ensureBrowserConnection,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { createWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import {
  acquireSessionLease,
  getSessionLease,
} from "@/lib/leases/session-lease";
import { buildNetworkSnowballTemplateConfig } from "@/lib/workflows/network-snowball";

function prepared(platform: "linkedin" | "x") {
  const handle = platform === "linkedin" ? "/in/operator" : "@operator";
  return {
    targetId: `target-${platform}`,
    platform,
    kind: platform === "linkedin" ? "profile" : "account",
    sessionName: "signals-publish",
    startUrl:
      platform === "linkedin"
        ? "https://www.linkedin.com/in/operator"
        : "https://x.com/operator",
    expectedHandle: handle,
    verified: true,
    verifiedHandle: handle,
    activation: { switched: false },
    lease: { leaseId: `lease-${platform}`, expiresAt: 1_800_000_000 },
  };
}

describe("Network Snowball browser target", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds all-platform runs to the authenticated LinkedIn session", async () => {
    platformTargetServiceMocks.prepareCurrentPlatformTarget.mockResolvedValue(
      prepared("linkedin"),
    );

    await expect(prepareNetworkSnowballTarget({
      config: { networkSnowball: { version: 1 }, targetPlatform: "all" },
      workflowRunId: "run-snowball",
    })).resolves.toMatchObject({
      ok: true,
      target: {
        targetId: "target-linkedin",
        platform: "linkedin",
        source: "session",
        sessionName: "signals-publish",
        leaseId: "lease-linkedin",
      },
    });
    expect(platformTargetServiceMocks.prepareCurrentPlatformTarget).toHaveBeenCalledWith(
      {
        platform: "linkedin",
        intent: "browse",
        holder: "network-snowball:run-snowball",
        leaseTtlSeconds: 1_800,
      },
      expect.anything(),
      expect.anything(),
    );
  });

  it("uses X only for an explicitly X-only run", async () => {
    platformTargetServiceMocks.prepareCurrentPlatformTarget.mockResolvedValue(prepared("x"));

    await prepareNetworkSnowballTarget({
      config: { networkSnowball: { version: 1 }, targetPlatform: "x" },
      workflowRunId: "run-x",
    });

    expect(platformTargetServiceMocks.prepareCurrentPlatformTarget).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "x", holder: "network-snowball:run-x" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("fails closed with an actionable preflight error when LinkedIn is signed out", async () => {
    platformTargetServiceMocks.prepareCurrentPlatformTarget.mockRejectedValue(
      new PlatformTargetError("LOGIN_REQUIRED", "signed out"),
    );

    await expect(prepareNetworkSnowballTarget({
      config: { networkSnowball: { version: 1 }, targetPlatform: "linkedin" },
      workflowRunId: "run-signed-out",
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "LOGIN_REQUIRED",
        message: expect.stringContaining("Settings → Platform connections"),
      },
    });
  });

  it("treats an already-gone completion lease as idempotently released", () => {
    platformTargetServiceMocks.releasePreparedPlatformTarget.mockImplementation(() => {
      throw new PlatformTargetError("LEASE_LOST", "already gone");
    });

    expect(releaseNetworkSnowballTarget("lease-gone")).toEqual({
      leaseId: "lease-gone",
      released: false,
      alreadyGone: true,
    });
  });

  it("releases only the latest lease still owned by the run", () => {
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/operator",
      handle: "/in/operator",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      config: JSON.stringify(buildNetworkSnowballTemplateConfig()),
    });
    const lease = acquireSessionLease(connection.id, {
      holder: `network-snowball:${run.id}`,
      targetId: target.id,
      intent: "browse",
      ttlSeconds: 1_800,
    });
    const config = JSON.stringify({
      ...buildNetworkSnowballTemplateConfig(),
      [SNOWBALL_BROWSER_TARGET_CONFIG_KEY]: {
        targetId: target.id,
        platform: "linkedin",
        source: "session",
        sessionName: connection.sessionName,
        startUrl: "https://www.linkedin.com/in/operator",
        expectedHandle: "/in/operator",
        verifiedHandle: "/in/operator",
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1_000),
      },
    });
    updateWorkflowRun(run.id, { config });

    expect(releaseNetworkSnowballTargetForRun(run.id)).toEqual({
      leaseId: lease.leaseId,
      released: true,
      alreadyGone: false,
    });
    expect(releaseNetworkSnowballTargetForRun(run.id)).toEqual({
      leaseId: lease.leaseId,
      released: false,
      alreadyGone: true,
    });
  });

  it("does not release a successor lease after the stored binding expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    const connection = ensureBrowserConnection({ sessionName: "signals-publish" });
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform: "linkedin",
      kind: "profile",
      name: "/in/operator",
      handle: "/in/operator",
      capabilities: ["browse", "publish"],
      source: "test",
    });
    const run = createWorkflowRun({
      workflowType: "search",
      status: "running",
      trigger: "template",
      config: JSON.stringify(buildNetworkSnowballTemplateConfig()),
    });
    const lease = acquireSessionLease(connection.id, {
      holder: `network-snowball:${run.id}`,
      targetId: target.id,
      intent: "browse",
      ttlSeconds: 30,
    });
    const config = JSON.stringify({
      ...buildNetworkSnowballTemplateConfig(),
      [SNOWBALL_BROWSER_TARGET_CONFIG_KEY]: {
        targetId: target.id,
        platform: "linkedin",
        source: "session",
        sessionName: connection.sessionName,
        startUrl: "https://www.linkedin.com/in/operator",
        expectedHandle: "/in/operator",
        verifiedHandle: "/in/operator",
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1_000),
      },
    });
    updateWorkflowRun(run.id, { config });
    vi.advanceTimersByTime(31_000);
    const successor = acquireSessionLease(connection.id, {
      holder: "network-snowball:successor",
      targetId: target.id,
      intent: "browse",
      ttlSeconds: 1_800,
    });

    expect(releaseNetworkSnowballTargetForRun(run.id)).toMatchObject({
      released: false,
      alreadyGone: true,
    });
    expect(getSessionLease(connection.id)?.leaseId).toBe(successor.leaseId);
  });
});
