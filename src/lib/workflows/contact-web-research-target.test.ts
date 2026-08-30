import { beforeEach, describe, expect, it, vi } from "vitest";

const platformTargetServiceMocks = vi.hoisted(() => ({
  prepareCurrentPlatformTarget: vi.fn(),
  preparePlatformTarget: vi.fn(),
  releasePreparedPlatformTarget: vi.fn(),
}));

vi.mock("@/lib/platforms/platform-target-service", () => platformTargetServiceMocks);

import {
  ensureBrowserConnection,
  forgetPlatformTarget,
  registerPlatformTarget,
} from "@/lib/db/queries/platform-targets";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import {
  describeResearchTargetError,
  prepareContactWebResearchTarget,
  selectContactWebResearchTarget,
} from "@/lib/workflows/contact-web-research-target";
import { resetCoreTables } from "@/test/db";

function registerTarget(input: {
  platform: "linkedin" | "x" | "facebook";
  handle: string;
  capabilities?: Array<"browse" | "publish">;
  externalId?: string;
}) {
  const connection = ensureBrowserConnection({ sessionName: `session-${input.platform}` });
  return registerPlatformTarget({
    connectionId: connection.id,
    platform: input.platform,
    kind: input.platform === "x" ? "account" : "profile",
    name: input.handle,
    handle: input.handle,
    externalId: input.externalId,
    capabilities: input.capabilities ?? ["browse", "publish"],
    source: "test",
  });
}

describe("contact web research target selection", () => {
  beforeEach(() => {
    resetCoreTables();
    vi.clearAllMocks();
  });

  it("honors an explicit target but does not select stored defaults for the inherited-session path", () => {
    const x = registerTarget({ platform: "x", handle: "@current" });
    registerTarget({ platform: "linkedin", handle: "/in/stale-default" });

    expect(selectContactWebResearchTarget({ targetId: x.id })).toEqual({
      ok: true,
      selection: { targetId: x.id, platform: "x", source: "config" },
    });
    expect(selectContactWebResearchTarget({})).toMatchObject({
      ok: false,
      error: { code: "NO_RESEARCH_TARGET" },
    });
  });

  it("fails explicit forgotten, unsupported-platform, and missing targets without fallback", () => {
    registerTarget({ platform: "x", handle: "@fallback" });
    const forgotten = registerTarget({ platform: "linkedin", handle: "/in/forgotten" });
    forgetPlatformTarget(forgotten.id);
    const facebook = registerTarget({ platform: "facebook", handle: "facebook-user" });

    expect(selectContactWebResearchTarget({ targetId: forgotten.id })).toMatchObject({
      ok: false,
      error: { code: "TARGET_FORGOTTEN" },
    });
    expect(selectContactWebResearchTarget({ contactWebResearch: { targetId: facebook.id } })).toMatchObject({
      ok: false,
      error: { code: "TARGET_CAPABILITY_UNSUPPORTED" },
    });
    expect(selectContactWebResearchTarget({ targetId: "missing" })).toMatchObject({
      ok: false,
      error: { code: "TARGET_NOT_FOUND" },
    });
  });

  it("canonicalizes an explicit merged target id", () => {
    const canonical = registerTarget({
      platform: "linkedin",
      handle: "/in/canonical",
      externalId: "linkedin-123",
    });
    const alias = registerTarget({ platform: "linkedin", handle: "/in/alias" });
    registerTarget({
      platform: "linkedin",
      handle: "/in/alias",
      externalId: "linkedin-123",
    });

    expect(selectContactWebResearchTarget({ targetId: alias.id })).toEqual({
      ok: true,
      selection: { targetId: canonical.id, platform: "linkedin", source: "config" },
    });
  });

  it("returns an actionable no-target error", () => {
    const selected = selectContactWebResearchTarget({});
    expect(selected).toMatchObject({ ok: false, error: { code: "NO_RESEARCH_TARGET" } });
    if (selected.ok) throw new Error("expected no target");
    expect(selected.error.message).toContain("Settings → Platform connections");
    expect(describeResearchTargetError(selected.error)).toBe(selected.error.message);
  });

  it("inherits the live LinkedIn identity from signals-publish instead of a stale default", async () => {
    registerTarget({ platform: "linkedin", handle: "/in/stale-default" });
    platformTargetServiceMocks.prepareCurrentPlatformTarget.mockResolvedValueOnce({
      targetId: "target-live-linkedin",
      platform: "linkedin",
      kind: "profile",
      sessionName: "signals-publish",
      startUrl: "https://www.linkedin.com/in/live",
      expectedHandle: "/in/live",
      verified: true,
      verifiedHandle: "/in/live",
      activation: { switched: false },
      lease: { leaseId: "lease-live", expiresAt: 1_800_000_000 },
    });

    await expect(
      prepareContactWebResearchTarget({ config: {}, workflowRunId: "run-live" }),
    ).resolves.toMatchObject({
      ok: true,
      target: {
        targetId: "target-live-linkedin",
        platform: "linkedin",
        source: "session",
        sessionName: "signals-publish",
        leaseId: "lease-live",
      },
    });
    expect(platformTargetServiceMocks.prepareCurrentPlatformTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "linkedin",
        intent: "browse",
        holder: "contact-web-research:run-live",
        leaseTtlSeconds: 600,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(platformTargetServiceMocks.preparePlatformTarget).not.toHaveBeenCalled();
  });

  it("falls back to the live X identity only when LinkedIn is signed out", async () => {
    platformTargetServiceMocks.prepareCurrentPlatformTarget
      .mockRejectedValueOnce(new PlatformTargetError("LOGIN_REQUIRED", "signed out"))
      .mockResolvedValueOnce({
        targetId: "target-live-x",
        platform: "x",
        kind: "account",
        sessionName: "signals-publish",
        startUrl: "https://x.com/live",
        expectedHandle: "@live",
        verified: true,
        verifiedHandle: "@live",
        activation: { switched: false },
        lease: { leaseId: "lease-x", expiresAt: 1_800_000_000 },
      });

    await expect(
      prepareContactWebResearchTarget({ config: {}, workflowRunId: "run-x" }),
    ).resolves.toMatchObject({
      ok: true,
      target: { platform: "x", source: "session", sessionName: "signals-publish" },
    });
    expect(platformTargetServiceMocks.prepareCurrentPlatformTarget).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ platform: "x" }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("keeps an explicit target exact and maps its preparation errors", async () => {
    const linkedin = registerTarget({ platform: "linkedin", handle: "/in/current" });
    platformTargetServiceMocks.preparePlatformTarget.mockResolvedValueOnce({
      targetId: linkedin.id,
      platform: "linkedin",
      kind: "profile",
      sessionName: "signals-publish",
      startUrl: "https://www.linkedin.com/in/current",
      expectedHandle: "/in/current",
      verified: true,
      verifiedHandle: "/in/current",
      activation: { switched: false },
      lease: { leaseId: "lease-1", expiresAt: 1_800_000_000 },
    });

    await expect(
      prepareContactWebResearchTarget({ config: { targetId: linkedin.id }, workflowRunId: "run-1" }),
    ).resolves.toMatchObject({
      ok: true,
      target: {
        targetId: linkedin.id,
        platform: "linkedin",
        source: "config",
        sessionName: "signals-publish",
        leaseId: "lease-1",
      },
    });
    expect(platformTargetServiceMocks.preparePlatformTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: linkedin.id,
        intent: "browse",
        holder: "contact-web-research:run-1",
        leaseTtlSeconds: 600,
      }),
      expect.anything(),
      expect.anything(),
    );

    platformTargetServiceMocks.preparePlatformTarget.mockRejectedValueOnce(
      new PlatformTargetError("LOGIN_REQUIRED", "signed out", { detectedHandle: null }),
    );
    await expect(
      prepareContactWebResearchTarget({ config: { targetId: linkedin.id }, workflowRunId: "run-2" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "LOGIN_REQUIRED", message: expect.stringContaining("Platform connections") },
    });
  });

  it("returns an actionable error when neither platform is authenticated in signals-publish", async () => {
    platformTargetServiceMocks.prepareCurrentPlatformTarget.mockRejectedValue(
      new PlatformTargetError("LOGIN_REQUIRED", "signed out"),
    );

    await expect(
      prepareContactWebResearchTarget({ config: {}, workflowRunId: "run-none" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NO_RESEARCH_TARGET",
        message: expect.stringContaining("signals-publish"),
      },
    });
  });
});
