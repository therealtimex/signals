import {
  getBrowserConnectionById,
  getPlatformTargetById,
} from "@/lib/db/queries/platform-targets";
import {
  getSessionLeaseById,
  renewSessionLease,
} from "@/lib/leases/session-lease";
import {
  prepareCurrentPlatformTarget,
  releasePreparedPlatformTarget,
} from "@/lib/platforms/platform-target-service";
import {
  PlatformTargetError,
  type PlatformTargetErrorCode,
} from "@/lib/platforms/target-errors";
import type { PlatformTargetPlatform } from "@/lib/platforms/target-identity";
import type { EnvLike } from "@/lib/rtx/env";
import { readNetworkSnowballConfig } from "@/lib/workflows/network-snowball";

export const SNOWBALL_BROWSER_TARGET_CONFIG_KEY = "_snowballBrowserTarget";
export const SNOWBALL_BROWSER_LEASE_TTL_SECONDS = 30 * 60;
export const SNOWBALL_BROWSER_LEASE_HOLDER_PREFIX = "network-snowball:";
export const SNOWBALL_BROWSER_SETTINGS_PATH = "/dashboard/settings?tab=platforms";

export type NetworkSnowballBrowserPlatform = Extract<
  PlatformTargetPlatform,
  "linkedin" | "x"
>;

export type NetworkSnowballPreparedTarget = {
  targetId: string;
  platform: NetworkSnowballBrowserPlatform;
  source: "session";
  sessionName: string;
  startUrl: string;
  expectedHandle: string | null;
  verifiedHandle: string | null;
  leaseId: string;
  leaseExpiresAt: number;
  preparedAt: number;
};

export type NetworkSnowballTargetError = {
  code: PlatformTargetErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type NetworkSnowballLeaseRelease = {
  leaseId: string;
  released: boolean;
  alreadyGone: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function targetPlatform(config: Record<string, unknown>): NetworkSnowballBrowserPlatform {
  // `all` is intentionally LinkedIn-backed. The Snowball write gate can only attest LinkedIn
  // identities when the server has first bound the run to the authenticated LinkedIn account.
  return readNetworkSnowballConfig(config).targetPlatform === "x" ? "x" : "linkedin";
}

export function describeNetworkSnowballTargetError(
  error: Pick<NetworkSnowballTargetError, "code" | "details">,
): string {
  const details = error.details ?? {};
  const platform = typeof details.platform === "string" ? details.platform : "configured";
  const sessionName =
    typeof details.sessionName === "string" ? details.sessionName : "signals-publish";

  switch (error.code) {
    case "LOGIN_REQUIRED":
    case "TARGET_NOT_ACTIVE":
      return `Network Snowball requires an authenticated ${platform} identity in ${sessionName}. Open Settings → Platform connections, sign in, then retry.`;
    case "SESSION_LEASE_HELD": {
      const holder = typeof details.holder === "string" ? details.holder : "another workflow";
      const retryAfter =
        typeof details.retryAfterSeconds === "number" ? details.retryAfterSeconds : 1;
      return `The ${sessionName} browser session is in use by ${holder}. Retry in ${retryAfter}s.`;
    }
    case "LEASE_LOST":
      return "The authenticated Network Snowball browser-session lease is no longer current. Restart the workflow so Signals can bind a fresh session.";
    case "CONNECTION_UNAVAILABLE":
      return `The RealTimeX Browser session ${sessionName} could not be started. Check Settings → Platform connections, then retry.`;
    case "TARGET_NOT_FOUND":
    case "TARGET_FORGOTTEN":
    case "TARGET_CAPABILITY_UNSUPPORTED":
    case "TARGET_ACTIVATION_UNSUPPORTED":
      return `The authenticated ${platform} browser target is unavailable. Reconnect it in Settings → Platform connections, then retry.`;
  }
}

function mappedTargetError(
  error: PlatformTargetError,
  platform: NetworkSnowballBrowserPlatform,
): NetworkSnowballTargetError {
  const details = {
    platform,
    sessionName: "signals-publish",
    ...(error.details ?? {}),
  };
  return {
    code: error.code,
    details,
    message: describeNetworkSnowballTargetError({ code: error.code, details }),
  };
}

export async function prepareNetworkSnowballTarget(
  input: { config: Record<string, unknown>; workflowRunId: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; target: NetworkSnowballPreparedTarget }
  | { ok: false; error: NetworkSnowballTargetError }
> {
  const platform = targetPlatform(input.config);
  try {
    const prepared = await prepareCurrentPlatformTarget(
      {
        platform,
        intent: "browse",
        holder: `${SNOWBALL_BROWSER_LEASE_HOLDER_PREFIX}${input.workflowRunId}`,
        leaseTtlSeconds: SNOWBALL_BROWSER_LEASE_TTL_SECONDS,
      },
      env,
      fetchImpl,
    );
    return {
      ok: true,
      target: {
        targetId: prepared.targetId,
        platform,
        source: "session",
        sessionName: prepared.sessionName,
        startUrl: prepared.startUrl,
        expectedHandle: prepared.expectedHandle,
        verifiedHandle: prepared.verifiedHandle,
        leaseId: prepared.lease.leaseId,
        leaseExpiresAt: prepared.lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1_000),
      },
    };
  } catch (error) {
    if (!(error instanceof PlatformTargetError)) throw error;
    return { ok: false, error: mappedTargetError(error, platform) };
  }
}

export function getNetworkSnowballTargetFromRunConfig(
  config: string | null | undefined,
): NetworkSnowballPreparedTarget | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = objectValue(JSON.parse(config ?? "{}")) ?? {};
  } catch {
    return null;
  }
  const target = objectValue(parsed[SNOWBALL_BROWSER_TARGET_CONFIG_KEY]);
  if (!target) return null;
  if (
    typeof target.targetId !== "string" ||
    (target.platform !== "linkedin" && target.platform !== "x") ||
    target.source !== "session" ||
    typeof target.sessionName !== "string" ||
    typeof target.startUrl !== "string" ||
    typeof target.leaseId !== "string" ||
    typeof target.leaseExpiresAt !== "number" ||
    typeof target.preparedAt !== "number"
  ) {
    return null;
  }
  return {
    targetId: target.targetId,
    platform: target.platform,
    source: target.source,
    sessionName: target.sessionName,
    startUrl: target.startUrl,
    expectedHandle: typeof target.expectedHandle === "string" ? target.expectedHandle : null,
    verifiedHandle: typeof target.verifiedHandle === "string" ? target.verifiedHandle : null,
    leaseId: target.leaseId,
    leaseExpiresAt: target.leaseExpiresAt,
    preparedAt: target.preparedAt,
  };
}

export function renewNetworkSnowballTargetLease(
  target: NetworkSnowballPreparedTarget,
  workflowRunId: string,
): { leaseId: string; expiresAt: number } {
  const platformTarget = getPlatformTargetById(target.targetId);
  const connection = platformTarget
    ? getBrowserConnectionById(platformTarget.connectionId)
    : undefined;
  const lease = getSessionLeaseById(target.leaseId);
  const expectedHolder = `${SNOWBALL_BROWSER_LEASE_HOLDER_PREFIX}${workflowRunId}`;
  const now = Math.floor(Date.now() / 1_000);
  if (
    !platformTarget ||
    platformTarget.platform !== target.platform ||
    !connection ||
    connection.sessionName !== target.sessionName ||
    !lease ||
    lease.expiresAt < now ||
    lease.targetId !== target.targetId ||
    lease.connectionId !== connection.id ||
    lease.holder !== expectedHolder
  ) {
    throw new PlatformTargetError(
      "LEASE_LOST",
      `Lease is no longer current: ${target.leaseId}`,
      { leaseId: target.leaseId, targetId: target.targetId },
    );
  }
  const renewed = renewSessionLease(target.leaseId, SNOWBALL_BROWSER_LEASE_TTL_SECONDS);
  return { leaseId: renewed.leaseId, expiresAt: renewed.expiresAt };
}

export function releaseNetworkSnowballTarget(
  leaseId: string,
): NetworkSnowballLeaseRelease {
  try {
    releasePreparedPlatformTarget(leaseId);
    return { leaseId, released: true, alreadyGone: false };
  } catch (error) {
    if (error instanceof PlatformTargetError && error.code === "LEASE_LOST") {
      return { leaseId, released: false, alreadyGone: true };
    }
    throw error;
  }
}

export function releaseNetworkSnowballTargetFromRunConfig(
  config: string | null | undefined,
): NetworkSnowballLeaseRelease | null {
  const target = getNetworkSnowballTargetFromRunConfig(config);
  return target ? releaseNetworkSnowballTarget(target.leaseId) : null;
}
