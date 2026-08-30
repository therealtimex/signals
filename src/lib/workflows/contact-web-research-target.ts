import {
  getBrowserConnectionById,
  getPlatformTargetById,
  resolveDefaultTarget,
  resolveTargetById,
  toPlatformTargetView,
} from "@/lib/db/queries/platform-targets";
import {
  preparePlatformTarget,
  releasePreparedPlatformTarget,
} from "@/lib/platforms/platform-target-service";
import {
  PlatformTargetError,
  type PlatformTargetErrorCode,
} from "@/lib/platforms/target-errors";
import type { EnvLike } from "@/lib/rtx/env";

export const CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER = ["linkedin", "x"] as const;
export type ContactWebResearchTargetPlatform =
  (typeof CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER)[number];

export const CONTACT_WEB_RESEARCH_LEASE_TTL_SECONDS = 600;
export const CONTACT_WEB_RESEARCH_LEASE_HOLDER_PREFIX = "contact-web-research:";
export const CONTACT_WEB_RESEARCH_SETTINGS_PATH = "/dashboard/settings?tab=platforms";

export type ContactWebResearchTargetSelection = {
  targetId: string;
  platform: ContactWebResearchTargetPlatform;
  source: "config" | "default";
};

export type ContactWebResearchTargetError = {
  code: "NO_RESEARCH_TARGET" | PlatformTargetErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type ContactWebResearchPreparedTarget = {
  targetId: string;
  platform: ContactWebResearchTargetPlatform;
  source: "config" | "default";
  sessionName: string;
  startUrl: string;
  expectedHandle: string | null;
  verifiedHandle: string | null;
  leaseId: string;
  leaseExpiresAt: number;
  preparedAt: number;
};

export type ContactWebResearchLeaseRelease = {
  leaseId: string;
  released: boolean;
  alreadyGone: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function explicitTargetId(config: Record<string, unknown>): string | null {
  const direct = typeof config.targetId === "string" ? config.targetId.trim() : "";
  if (direct) return direct;
  const research = objectValue(config.contactWebResearch);
  const nested = typeof research?.targetId === "string" ? research.targetId.trim() : "";
  return nested || null;
}

function isResearchPlatform(value: string): value is ContactWebResearchTargetPlatform {
  return (CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER as readonly string[]).includes(value);
}

function targetContext(targetId: string): Record<string, unknown> {
  const target = resolveTargetById(targetId);
  const connection = target ? getBrowserConnectionById(target.connectionId) : undefined;
  return {
    targetId: target?.id ?? targetId,
    ...(target ? { platform: target.platform, targetName: target.name } : {}),
    ...(connection ? { sessionName: connection.sessionName } : {}),
  };
}

function researchTargetError(
  code: ContactWebResearchTargetError["code"],
  details?: Record<string, unknown>,
): ContactWebResearchTargetError {
  const error = { code, message: "", ...(details ? { details } : {}) };
  return { ...error, message: describeResearchTargetError(error) };
}

export function describeResearchTargetError(
  error: Pick<ContactWebResearchTargetError, "code" | "details">,
): string {
  const details = error.details ?? {};
  const platform = typeof details.platform === "string" ? details.platform : "configured";
  const targetName =
    typeof details.targetName === "string" ? details.targetName : "the configured target";
  const targetId = typeof details.targetId === "string" ? details.targetId : "unknown";
  const sessionName =
    typeof details.sessionName === "string" ? details.sessionName : "configured";

  switch (error.code) {
    case "NO_RESEARCH_TARGET":
      return "No authenticated LinkedIn or X browser target is connected for contact research. Open Settings → Platform connections, connect LinkedIn in the RealTimeX Browser session, then retry.";
    case "LOGIN_REQUIRED":
    case "TARGET_NOT_ACTIVE": {
      const detected =
        typeof details.detectedHandle === "string" && details.detectedHandle.trim()
          ? ` (${details.detectedHandle})`
          : "";
      return `The ${platform} browser session is signed out or signed in as a different account${detected}. Open Settings → Platform connections and verify ${targetName}, then retry.`;
    }
    case "TARGET_ACTIVATION_UNSUPPORTED":
      return `The ${platform} browser session is signed in as a different account and cannot switch automatically. Open Settings → Platform connections, use the configured account (or a dedicated connection), verify it, then retry.`;
    case "CONNECTION_UNAVAILABLE":
      return `The RealTimeX Browser session ${sessionName} could not be started. Check Settings → Platform connections, then retry.`;
    case "SESSION_LEASE_HELD": {
      const holder = typeof details.holder === "string" ? details.holder : "another workflow";
      const retryAfter =
        typeof details.retryAfterSeconds === "number" ? details.retryAfterSeconds : 1;
      return `The ${sessionName} browser session is in use by ${holder}. Retry in ${retryAfter}s.`;
    }
    case "TARGET_FORGOTTEN":
    case "TARGET_NOT_FOUND":
    case "TARGET_CAPABILITY_UNSUPPORTED":
      return `The configured research target ${targetId} is unavailable. Re-discover targets in Settings → Platform connections or clear contactWebResearch.targetId.`;
    case "LEASE_LOST":
      return "The authenticated browser-session lease expired before contact research could start. Retry the enrichment.";
  }
}

export function selectContactWebResearchTarget(
  config: Record<string, unknown>,
):
  | { ok: true; selection: ContactWebResearchTargetSelection }
  | { ok: false; error: ContactWebResearchTargetError } {
  const configuredTargetId = explicitTargetId(config);
  if (configuredTargetId) {
    const raw = getPlatformTargetById(configuredTargetId);
    if (!raw) {
      return {
        ok: false,
        error: researchTargetError("TARGET_NOT_FOUND", { targetId: configuredTargetId }),
      };
    }
    if (raw.status === "forgotten") {
      return {
        ok: false,
        error: researchTargetError("TARGET_FORGOTTEN", { targetId: configuredTargetId }),
      };
    }

    const target = resolveTargetById(configuredTargetId);
    if (!target || target.status !== "active") {
      return {
        ok: false,
        error: researchTargetError("TARGET_NOT_FOUND", { targetId: configuredTargetId }),
      };
    }
    const view = toPlatformTargetView(target);
    if (!isResearchPlatform(target.platform) || !view.capabilities.includes("browse")) {
      return {
        ok: false,
        error: researchTargetError("TARGET_CAPABILITY_UNSUPPORTED", targetContext(target.id)),
      };
    }
    return {
      ok: true,
      selection: { targetId: target.id, platform: target.platform, source: "config" },
    };
  }

  for (const platform of CONTACT_WEB_RESEARCH_TARGET_PLATFORM_ORDER) {
    const target = resolveDefaultTarget(platform);
    if (!target || !toPlatformTargetView(target).capabilities.includes("browse")) continue;
    return {
      ok: true,
      selection: { targetId: target.id, platform, source: "default" },
    };
  }

  return { ok: false, error: researchTargetError("NO_RESEARCH_TARGET") };
}

export async function prepareContactWebResearchTarget(
  input: { config: Record<string, unknown>; workflowRunId: string },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { ok: true; target: ContactWebResearchPreparedTarget }
  | { ok: false; error: ContactWebResearchTargetError }
> {
  const selected = selectContactWebResearchTarget(input.config);
  if (!selected.ok) return selected;

  try {
    const prepared = await preparePlatformTarget(
      {
        targetId: selected.selection.targetId,
        intent: "browse",
        holder: `${CONTACT_WEB_RESEARCH_LEASE_HOLDER_PREFIX}${input.workflowRunId}`,
        leaseTtlSeconds: CONTACT_WEB_RESEARCH_LEASE_TTL_SECONDS,
      },
      env,
      fetchImpl,
    );
    return {
      ok: true,
      target: {
        ...selected.selection,
        sessionName: prepared.sessionName,
        startUrl: prepared.startUrl,
        expectedHandle: prepared.expectedHandle,
        verifiedHandle: prepared.verifiedHandle,
        leaseId: prepared.lease.leaseId,
        leaseExpiresAt: prepared.lease.expiresAt,
        preparedAt: Math.floor(Date.now() / 1000),
      },
    };
  } catch (error) {
    if (!(error instanceof PlatformTargetError)) throw error;
    return {
      ok: false,
      error: researchTargetError(error.code, {
        ...targetContext(selected.selection.targetId),
        ...(error.details ?? {}),
      }),
    };
  }
}

export function releaseContactWebResearchTarget(
  leaseId: string,
): ContactWebResearchLeaseRelease {
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

export function getContactWebResearchTargetFromRunConfig(
  config: string | null | undefined,
): ContactWebResearchPreparedTarget | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = objectValue(JSON.parse(config ?? "{}")) ?? {};
  } catch {
    return null;
  }
  const target = objectValue(parsed.researchTarget);
  if (!target) return null;
  if (
    typeof target.targetId !== "string" ||
    !isResearchPlatform(String(target.platform)) ||
    (target.source !== "config" && target.source !== "default") ||
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
    platform: target.platform as ContactWebResearchTargetPlatform,
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

export function releaseContactWebResearchTargetFromRunConfig(
  config: string | null | undefined,
): ContactWebResearchLeaseRelease | null {
  const target = getContactWebResearchTargetFromRunConfig(config);
  return target ? releaseContactWebResearchTarget(target.leaseId) : null;
}
