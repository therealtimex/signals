import type { Platform } from "@/lib/db/platforms";
import {
  canReachPublishAdapter,
  getSurfaceCapabilities,
  type PublishCapability,
  type SurfaceCapabilities,
} from "@/lib/writing/capabilities";
import {
  NURTURE_WRITING_SURFACES,
  type WritingIntentMandate,
} from "@/lib/writing/writing-intent";
import type { SurfaceId } from "@/lib/writing/surfaces";

export const NURTURE_APPROVAL_GATE_VERSION = 1;
export const NURTURE_APPROVAL_GATE_CONFIG_KEY = "approvalGate";

export type NurtureApprovalGateMode = "locked_explicit" | "operator_choice";
export type NurtureApprovalGateReason =
  | "assist_only_mandate"
  | "no_publish_adapter"
  | "explicit_floor"
  | "publish_capable";
export type NurtureApprovalFloor = "explicit" | "capability";

export const NURTURE_SURFACE_APPROVAL_FLOOR: Record<
  (typeof NURTURE_WRITING_SURFACES)[number],
  NurtureApprovalFloor
> = {
  "x/reply": "capability",
  "x/direct_message": "explicit",
  "linkedin/comment": "capability",
  "linkedin/direct_message": "explicit",
  "facebook/comment": "capability",
  "facebook/direct_message": "explicit",
};

export interface NurtureApprovalGateSurface {
  surface: SurfaceId;
  publish: PublishCapability;
  mandate: WritingIntentMandate | null;
  floor: NurtureApprovalFloor;
  approval: "explicit" | "operator_choice";
  reason: NurtureApprovalGateReason;
}

export interface NurtureApprovalGate {
  schemaVersion: typeof NURTURE_APPROVAL_GATE_VERSION;
  mode: NurtureApprovalGateMode;
  reason: NurtureApprovalGateReason;
  platform: Platform | null;
  surfaces: NurtureApprovalGateSurface[];
}

export function applyNurtureApprovalGate<T extends { requireApproval: boolean }>(
  value: T,
  gate: NurtureApprovalGate,
): T {
  return gate.mode === "locked_explicit" && !value.requireApproval
    ? { ...value, requireApproval: true }
    : value;
}

type CapabilityLookup = (surface: SurfaceId) => SurfaceCapabilities;

/**
 * Resolve what the activation UI may promise from the same capability registry materialization uses.
 *
 * The optional lookup is dependency injection for the future operator-choice test. Production callers
 * always use the live registry; no config value can widen the gate.
 */
export function resolveNurtureApprovalGate(
  platform: Platform | null,
  lookup: CapabilityLookup = getSurfaceCapabilities,
): NurtureApprovalGate {
  const scoped = (NURTURE_WRITING_SURFACES as readonly SurfaceId[]).filter(
    (surface) => platform === null || surface.startsWith(`${platform}/`),
  );
  const surfaces = scoped.map<NurtureApprovalGateSurface>((surface) => {
    const capability = lookup(surface);
    const floor = NURTURE_SURFACE_APPROVAL_FLOOR[surface as keyof typeof NURTURE_SURFACE_APPROVAL_FLOOR];
    if (floor === "explicit") {
      return {
        surface,
        publish: capability.publish,
        mandate: capability.mandate,
        floor,
        approval: "explicit",
        reason: "explicit_floor",
      };
    }
    if (capability.mandate === "assist_only") {
      return {
        surface,
        publish: capability.publish,
        mandate: capability.mandate,
        floor,
        approval: "explicit",
        reason: "assist_only_mandate",
      };
    }
    if (!canReachPublishAdapter(capability.publish)) {
      return {
        surface,
        publish: capability.publish,
        mandate: capability.mandate,
        floor,
        approval: "explicit",
        reason: "no_publish_adapter",
      };
    }
    return {
      surface,
      publish: capability.publish,
      mandate: capability.mandate,
      floor,
      approval: "operator_choice",
      reason: "publish_capable",
    };
  });

  const operatorChoice = surfaces.some((surface) => surface.approval === "operator_choice");
  const reason: NurtureApprovalGateReason = operatorChoice
    ? "publish_capable"
    : surfaces.some((surface) => surface.reason === "assist_only_mandate")
      ? "assist_only_mandate"
      : surfaces.some((surface) => surface.reason === "no_publish_adapter")
        ? "no_publish_adapter"
        : "explicit_floor";

  return {
    schemaVersion: NURTURE_APPROVAL_GATE_VERSION,
    mode: operatorChoice ? "operator_choice" : "locked_explicit",
    reason,
    platform,
    surfaces,
  };
}

function isGateSurface(value: unknown): value is NurtureApprovalGateSurface {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NurtureApprovalGateSurface>;
  return (
    typeof row.surface === "string" &&
    typeof row.publish === "string" &&
    (row.mandate === "assist_only" || row.mandate === null) &&
    (row.floor === "explicit" || row.floor === "capability") &&
    (row.approval === "explicit" || row.approval === "operator_choice") &&
    typeof row.reason === "string"
  );
}

export function readNurtureApprovalGate(config: Record<string, unknown>): NurtureApprovalGate | null {
  const value = config[NURTURE_APPROVAL_GATE_CONFIG_KEY];
  if (!value || typeof value !== "object") return null;
  const gate = value as Partial<NurtureApprovalGate>;
  if (
    gate.schemaVersion !== NURTURE_APPROVAL_GATE_VERSION ||
    (gate.mode !== "locked_explicit" && gate.mode !== "operator_choice") ||
    typeof gate.reason !== "string" ||
    (gate.platform !== null && typeof gate.platform !== "string") ||
    !Array.isArray(gate.surfaces) ||
    !gate.surfaces.every(isGateSurface)
  ) {
    return null;
  }
  return gate as NurtureApprovalGate;
}
