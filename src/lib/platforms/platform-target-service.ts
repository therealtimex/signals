import { nanoid } from "nanoid";
import {
  ensureBrowserConnection,
  getBrowserConnectionById,
  getPlatformTargetById,
  markPlatformTargetVerified,
  resolveTargetById,
  registerPlatformTarget,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";
import {
  acquireSessionLease,
  getSessionLeaseById,
  releaseSessionLease,
  renewSessionLease,
  type SessionLeaseIntent,
} from "@/lib/leases/session-lease";
import { withPlatformBrowserPage, getPlatformHomeUrl } from "@/lib/platforms/browser-connection";
import { getPlatformTargetAdapter } from "@/lib/platforms/target-adapters";
import { PlatformTargetError } from "@/lib/platforms/target-errors";
import type { PlatformTargetPlatform } from "@/lib/platforms/target-identity";
import { RTX_PUBLISH_SESSION_NAME } from "@/lib/publish/constants";
import type { EnvLike } from "@/lib/rtx/env";

export type PreparePlatformTargetInput = {
  targetId: string;
  intent: "browse" | "publish";
  leaseId?: string;
  leaseTtlSeconds?: number;
  holder?: string;
};

function requireActiveTarget(targetId: string) {
  const raw = getPlatformTargetById(targetId);
  if (!raw) {
    throw new PlatformTargetError("TARGET_NOT_FOUND", `Platform target not found: ${targetId}`, {
      targetId,
    });
  }
  if (raw.status === "forgotten") {
    throw new PlatformTargetError("TARGET_FORGOTTEN", `Platform target is forgotten: ${targetId}`, {
      targetId,
    });
  }
  const target = resolveTargetById(targetId);
  if (!target || target.status !== "active") {
    throw new PlatformTargetError("TARGET_NOT_FOUND", `Platform target not found: ${targetId}`, {
      targetId,
    });
  }
  return target;
}

function acquireOrRenewLease(
  connectionId: string,
  targetId: string,
  intent: SessionLeaseIntent,
  input: PreparePlatformTargetInput
) {
  if (!input.leaseId) {
    return acquireSessionLease(connectionId, {
      holder: input.holder?.trim() || `agent:${nanoid()}`,
      targetId,
      intent,
      ttlSeconds: input.leaseTtlSeconds,
    });
  }

  const current = getSessionLeaseById(input.leaseId);
  if (
    !current ||
    current.connectionId !== connectionId ||
    current.targetId !== targetId
  ) {
    throw new PlatformTargetError("LEASE_LOST", `Lease is no longer current: ${input.leaseId}`, {
      leaseId: input.leaseId,
    });
  }
  return renewSessionLease(input.leaseId, input.leaseTtlSeconds);
}

export async function preparePlatformTarget(
  input: PreparePlatformTargetInput,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
) {
  const target = requireActiveTarget(input.targetId);
  const targetView = toPlatformTargetView(target);
  if (!targetView.capabilities.includes(input.intent)) {
    throw new PlatformTargetError(
      "TARGET_CAPABILITY_UNSUPPORTED",
      `${target.platform} ${target.kind} target does not support ${input.intent}`,
      { targetId: target.id, intent: input.intent }
    );
  }

  const connection = getBrowserConnectionById(target.connectionId);
  if (!connection || connection.status !== "active") {
    throw new PlatformTargetError(
      "CONNECTION_UNAVAILABLE",
      `Browser connection is unavailable: ${target.connectionId}`,
      { connectionId: target.connectionId }
    );
  }

  const lease = acquireOrRenewLease(connection.id, target.id, input.intent, input);
  try {
    const activation = await withPlatformBrowserPage(
      target.platform as PlatformTargetPlatform,
      connection.sessionName,
      (page) =>
        getPlatformTargetAdapter(target.platform as PlatformTargetPlatform).activate(page, target),
      env,
      fetchImpl
    ).catch((error) => {
      if (error instanceof PlatformTargetError) throw error;
      throw new PlatformTargetError(
        "CONNECTION_UNAVAILABLE",
        error instanceof Error ? error.message : "Browser connection is unavailable",
        { connectionId: connection.id, sessionName: connection.sessionName }
      );
    });

    if (!activation.loggedIn) {
      throw new PlatformTargetError(
        "LOGIN_REQUIRED",
        `Login is required for ${target.platform} in ${connection.sessionName}`,
        { targetId: target.id, sessionName: connection.sessionName }
      );
    }
    if (!activation.active) {
      throw new PlatformTargetError(
        "TARGET_NOT_ACTIVE",
        `Live ${target.platform} identity does not match target ${target.name}`,
        {
          targetId: target.id,
          expectedHandle: target.handle,
          detectedHandle: activation.detectedHandle,
        }
      );
    }

    markPlatformTargetVerified(target.id);
    return {
      targetId: target.id,
      platform: target.platform,
      kind: target.kind,
      sessionName: connection.sessionName,
      startUrl: target.canonicalUrl ?? getPlatformHomeUrl(target.platform as PlatformTargetPlatform),
      expectedHandle: target.handle,
      verified: true,
      verifiedHandle: activation.detectedHandle,
      activation: { switched: activation.switched },
      lease: { leaseId: lease.leaseId, expiresAt: lease.expiresAt },
    };
  } catch (error) {
    try {
      releaseSessionLease(lease.leaseId);
    } catch {
      // A stolen/expired lease is already released from this holder's perspective.
    }
    throw error;
  }
}

export function releasePreparedPlatformTarget(leaseId: string): { released: true } {
  releaseSessionLease(leaseId);
  return { released: true };
}

export function requirePlatformTarget(targetId: string) {
  return requireActiveTarget(targetId);
}

async function discoverOnConnection(
  platform: PlatformTargetPlatform,
  connectionId: string | undefined,
  env: EnvLike,
  fetchImpl: typeof fetch
) {
  const connection = connectionId
    ? getBrowserConnectionById(connectionId)
    : ensureBrowserConnection({
        sessionName: RTX_PUBLISH_SESSION_NAME,
        kind: "shared",
        source: "platform-target-discovery",
      });
  if (!connection || connection.status !== "active") {
    throw new PlatformTargetError(
      "CONNECTION_UNAVAILABLE",
      `Browser connection is unavailable: ${connectionId ?? RTX_PUBLISH_SESSION_NAME}`
    );
  }

  const lease = acquireSessionLease(connection.id, {
    holder: `settings:discover:${platform}:${nanoid()}`,
    intent: "discover",
  });
  const discovered = await (async () => {
    try {
      return await withPlatformBrowserPage(
        platform,
        connection.sessionName,
        (page) => getPlatformTargetAdapter(platform).discover(page),
        env,
        fetchImpl
      ).catch((error) => {
        if (error instanceof PlatformTargetError) throw error;
        throw new PlatformTargetError(
          "CONNECTION_UNAVAILABLE",
          error instanceof Error ? error.message : "Browser connection is unavailable",
          { connectionId: connection.id, sessionName: connection.sessionName }
        );
      });
    } finally {
      try {
        releaseSessionLease(lease.leaseId);
      } catch {
        // Expired/stolen discovery leases no longer need cleanup.
      }
    }
  })();
  if (discovered.length === 0) {
    throw new PlatformTargetError(
      "LOGIN_REQUIRED",
      `No logged-in ${platform} identity was detected in ${connection.sessionName}`,
      { connectionId: connection.id, sessionName: connection.sessionName }
    );
  }
  return { connection, discovered };
}

export async function discoverAndRegisterPlatformTargets(
  platform: PlatformTargetPlatform,
  connectionId?: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
) {
  const { connection, discovered } = await discoverOnConnection(
    platform,
    connectionId,
    env,
    fetchImpl
  );
  let authPrincipalTargetId: string | null = null;
  const targets = discovered.map((candidate) => {
    const target = registerPlatformTarget({
      connectionId: connection.id,
      platform,
      kind: candidate.kind,
      externalId: candidate.externalId,
      name: candidate.name,
      handle: candidate.handle,
      canonicalUrl: candidate.canonicalUrl,
      authPrincipalTargetId:
        candidate.kind === "page" ? authPrincipalTargetId : null,
      capabilities: candidate.capabilities,
      source: "platform-target-discovery",
    });
    if (candidate.kind === "profile" && !authPrincipalTargetId) {
      authPrincipalTargetId = target.id;
    }
    return toPlatformTargetView(target);
  });
  return { connection, targets };
}

export async function registerCurrentPlatformTarget(
  platform: PlatformTargetPlatform,
  connectionId?: string,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
) {
  const { connection, discovered } = await discoverOnConnection(
    platform,
    connectionId,
    env,
    fetchImpl
  );
  const candidate = discovered[0];
  const target = registerPlatformTarget({
    connectionId: connection.id,
    platform,
    kind: candidate.kind,
    externalId: candidate.externalId,
    name: candidate.name,
    handle: candidate.handle,
    canonicalUrl: candidate.canonicalUrl,
    capabilities: candidate.capabilities,
    source: "platform-target-register-current",
  });
  return { connection, target: toPlatformTargetView(target) };
}
