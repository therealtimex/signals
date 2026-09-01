import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";
import { approvalEvidenceSchema } from "@/lib/writing/contracts";
import {
  type TargetRepresentation,
  targetRepresentationSchema,
} from "@/lib/writing/personality-lineage";

export const targetPersonalityDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  represents: targetRepresentationSchema,
  setAt: z.number().int().nonnegative(),
  by: z.literal("user"),
  evidence: approvalEvidenceSchema,
  bindingIdAtDecision: z.string().regex(/^pb_[A-Za-z0-9_-]{6,}$/),
}).strict();

export type TargetPersonalityDecision = z.infer<typeof targetPersonalityDecisionSchema>;

export type TargetRepresentationProjection = {
  represents: TargetRepresentation;
  personalityDecision: TargetPersonalityDecision | null;
};

export type PersonalityIdentity = {
  selfContactId: string;
  representedOrgId: string | null;
};

export function parseMetadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseMetadataObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readTargetPersonalityDecision(
  targetOrMetadata: { metadata: unknown } | unknown,
): TargetPersonalityDecision | null {
  const metadata = parseMetadataObject(
    targetOrMetadata && typeof targetOrMetadata === "object" && "metadata" in targetOrMetadata
      ? (targetOrMetadata as { metadata: unknown }).metadata
      : targetOrMetadata,
  );
  const parsed = targetPersonalityDecisionSchema.safeParse(metadata.personality);
  return parsed.success ? parsed.data : null;
}

export function projectTargetRepresentation(
  targetOrMetadata: { metadata: unknown } | unknown,
): TargetRepresentationProjection {
  const personalityDecision = readTargetPersonalityDecision(targetOrMetadata);
  return {
    represents: personalityDecision?.represents ?? { kind: "unbound" },
    personalityDecision,
  };
}

export function isTargetRepresentationCompatible(
  representation: TargetRepresentation,
  identity: PersonalityIdentity,
): boolean {
  if (representation.kind === "self") {
    return representation.contactId === identity.selfContactId;
  }
  if (representation.kind === "org") {
    return identity.representedOrgId !== null && representation.orgId === identity.representedOrgId;
  }
  return false;
}

export function compatibleTargetIds(
  targets: Array<{ id: string; status?: string; metadata: unknown }>,
  identity: PersonalityIdentity,
): string[] {
  return targets
    .filter((target) => target.status === undefined || target.status === "active")
    .filter((target) => isTargetRepresentationCompatible(
      projectTargetRepresentation(target).represents,
      identity,
    ))
    .map((target) => target.id)
    .sort();
}

function isConcrete(decision: TargetPersonalityDecision | null): decision is TargetPersonalityDecision {
  return decision !== null && decision.represents.kind !== "unbound";
}

function sameRepresentation(left: TargetRepresentation, right: TargetRepresentation): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "self" && right.kind === "self") return left.contactId === right.contactId;
  if (left.kind === "org" && right.kind === "org") return left.orgId === right.orgId;
  return left.kind === "unbound" && right.kind === "unbound";
}

export function mergeTargetPersonalityMetadata(
  primaryMetadata: unknown,
  aliasMetadata: unknown,
): Record<string, unknown> {
  const primary = parseMetadataObject(primaryMetadata);
  const alias = parseMetadataObject(aliasMetadata);
  const primaryDecision = readTargetPersonalityDecision(primary);
  const aliasDecision = readTargetPersonalityDecision(alias);
  if (
    isConcrete(primaryDecision)
    && isConcrete(aliasDecision)
    && !sameRepresentation(primaryDecision.represents, aliasDecision.represents)
  ) {
    throw new AgentToolError(
      "CONFLICT",
      "Platform target aliases have incompatible Personality representations",
      { reason: "target_representation_conflict" },
    );
  }
  const selected = isConcrete(primaryDecision)
    ? primaryDecision
    : isConcrete(aliasDecision)
      ? aliasDecision
      : primaryDecision ?? aliasDecision;
  return {
    ...primary,
    ...(selected ? { personality: selected } : {}),
  };
}
