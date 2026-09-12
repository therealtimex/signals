import { getBrowserConnectionBySessionName } from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  releaseSessionLease,
} from "@/lib/leases/session-lease";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import {
  findRtxBrowserSession,
  listRtxBrowserSessions,
  resolveRtxDebugPort,
} from "@/lib/rtx/browser-sessions";
import type { EnvLike } from "@/lib/rtx/env";

export const SNOWBALL_SOURCE_BROWSER_TARGET_CONFIG_KEY = "_snowballSourceBrowserTarget";
export const SNOWBALL_SOURCE_BROWSER_LEASE_TTL_SECONDS = 30 * 60;
export const SNOWBALL_SOURCE_BROWSER_LEASE_HOLDER_PREFIX = "network-snowball-source:";

export type NetworkSnowballPreparedSourceTarget = {
  source: "participant_access";
  sessionName: string;
  startUrl: string;
  leaseId: string;
  leaseExpiresAt: number;
  preparedAt: number;
};

export type NetworkSnowballSourceTargetError = {
  code: "CONNECTION_UNAVAILABLE" | "SESSION_LEASE_HELD";
  message: string;
  details?: Record<string, unknown>;
};

export type NetworkSnowballSourceLeaseRelease = {
  leaseId: string;
  released: boolean;
  alreadyGone: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unavailable(
  sessionName: string,
  message: string,
): { ok: false; error: NetworkSnowballSourceTargetError } {
  return {
    ok: false,
    error: {
      code: "CONNECTION_UNAVAILABLE",
      message,
      details: { sessionName },
    },
  };
}

/**
 * Bind generic event-source navigation to the exact user-selected browser session.
 *
 * This deliberately does not create, start, or substitute a session. Generic providers do not
 * expose a common identity probe, so availability plus explicit consent is the enforceable gate;
 * provider-specific adapters (currently Luma) perform their own stronger identity/access checks.
 */
export async function prepareNetworkSnowballSourceTarget(
  input: { workflowRunId: string; sessionName: string; startUrl: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; target: NetworkSnowballPreparedSourceTarget }
  | { ok: false; error: NetworkSnowballSourceTargetError }
> {
  const requestedSessionName = input.sessionName.trim();
  const connection = getBrowserConnectionBySessionName(requestedSessionName);
  if (!connection || connection.status !== "active") {
    return unavailable(
      requestedSessionName,
      `The selected browser session ${requestedSessionName} is not registered in Signals.`,
    );
  }

  let sessions;
  try {
    sessions = await listRtxBrowserSessions(env, fetchImpl);
  } catch (error) {
    return unavailable(
      requestedSessionName,
      error instanceof Error ? error.message : "Browser sessions could not be listed.",
    );
  }
  const session = findRtxBrowserSession(sessions, requestedSessionName);
  if (!session || session.running === false || !resolveRtxDebugPort(session)) {
    return unavailable(
      requestedSessionName,
      `The selected browser session ${requestedSessionName} is not running.`,
    );
  }

  try {
    const lease = acquireSessionLease(connection.id, {
      holder: `${SNOWBALL_SOURCE_BROWSER_LEASE_HOLDER_PREFIX}${input.workflowRunId}`,
      targetId: null,
      intent: "browse",
      ttlSeconds: SNOWBALL_SOURCE_BROWSER_LEASE_TTL_SECONDS,
    });
    return {
      ok: true,
      target: {
        source: "participant_access",
        sessionName: connection.sessionName,
        startUrl: input.startUrl,
        leaseId: lease.leaseId,
        leaseExpiresAt: lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1_000),
      },
    };
  } catch (error) {
    if (error instanceof PlatformTargetError && error.code === "SESSION_LEASE_HELD") {
      return {
        ok: false,
        error: {
          code: "SESSION_LEASE_HELD",
          message: `The selected browser session ${requestedSessionName} is already in use.`,
          details: { sessionName: requestedSessionName, ...(error.details ?? {}) },
        },
      };
    }
    throw error;
  }
}

export function getNetworkSnowballSourceTargetFromRunConfig(
  config: string | null | undefined,
): NetworkSnowballPreparedSourceTarget | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = objectValue(JSON.parse(config ?? "{}")) ?? {};
  } catch {
    return null;
  }
  const target = objectValue(parsed[SNOWBALL_SOURCE_BROWSER_TARGET_CONFIG_KEY]);
  if (
    !target ||
    target.source !== "participant_access" ||
    typeof target.sessionName !== "string" ||
    typeof target.startUrl !== "string" ||
    typeof target.leaseId !== "string" ||
    typeof target.leaseExpiresAt !== "number" ||
    typeof target.preparedAt !== "number"
  ) {
    return null;
  }
  return {
    source: target.source,
    sessionName: target.sessionName,
    startUrl: target.startUrl,
    leaseId: target.leaseId,
    leaseExpiresAt: target.leaseExpiresAt,
    preparedAt: target.preparedAt,
  };
}

export function releaseNetworkSnowballSourceTarget(
  leaseId: string,
): NetworkSnowballSourceLeaseRelease {
  try {
    releaseSessionLease(leaseId);
    return { leaseId, released: true, alreadyGone: false };
  } catch (error) {
    if (error instanceof PlatformTargetError && error.code === "LEASE_LOST") {
      return { leaseId, released: false, alreadyGone: true };
    }
    throw error;
  }
}

export function releaseNetworkSnowballSourceTargetFromRunConfig(
  config: string | null | undefined,
): NetworkSnowballSourceLeaseRelease | null {
  const target = getNetworkSnowballSourceTargetFromRunConfig(config);
  return target ? releaseNetworkSnowballSourceTarget(target.leaseId) : null;
}
