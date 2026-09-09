import { beforeEach, describe, expect, it, vi } from "vitest";

const platformTargetServiceMocks = vi.hoisted(() => ({
  prepareCurrentPlatformTarget: vi.fn(),
  releasePreparedPlatformTarget: vi.fn(),
}));

vi.mock("@/lib/platforms/platform-target-service", () => platformTargetServiceMocks);

import {
  prepareNetworkSnowballTarget,
  releaseNetworkSnowballTarget,
} from "@/lib/workflows/network-snowball-target";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import { resetCoreTables } from "@/test/db";

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
});
