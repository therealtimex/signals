import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import {
  approvePersonalityProposal,
  retryPersonalityProposal,
} from "@/lib/personality/apply";
import { platformTargets } from "@/lib/db/schema";
import { toPlatformTargetView } from "@/lib/db/queries/platform-targets";
import {
  isTargetRepresentationCompatible,
  parseMetadataObject,
  targetPersonalityDecisionSchema,
} from "@/lib/personality/target-representation";
import type { ApprovalEvidence } from "@/lib/writing/contracts";
import type { TargetRepresentation } from "@/lib/writing/personality-lineage";
import { withPersonalityStore } from "@/lib/personality/store";
import {
  getRepresentedOrgId,
  setRepresentedOrgId,
} from "@/lib/settings/signals-config";
import {
  stampVariantPersonality,
  withPersonalityWritingGuard,
  type PersonalityGuardDependencies,
} from "@/lib/writing/personality-guard";
import {
  reconcilePersonalityBinding,
  revokeVariantsForTargetRepresentationWithRunner,
} from "@/lib/writing/personality-revocation";

const reconcileCommittedBinding = (result: {
  binding: { id: string } | null;
}) => {
  reconcilePersonalityBinding(result.binding?.id ?? null);
};

export function approvePersonalityProjection(input: Parameters<typeof approvePersonalityProposal>[0]) {
  return approvePersonalityProposal(input, { onBindingCommitted: reconcileCommittedBinding });
}

export function retryPersonalityProjection(proposalId: string) {
  return retryPersonalityProposal(proposalId, { onBindingCommitted: reconcileCommittedBinding });
}

export function setRepresentedOrganization(orgId: string | null) {
  return withPersonalityStore(() => {
    if (getRepresentedOrgId() === orgId) {
      return setRepresentedOrgId(orgId);
    }
    const config = setRepresentedOrgId(orgId);
    reconcilePersonalityBinding(null);
    return config;
  });
}

export async function setTargetRepresentation(input: {
  targetId: string;
  bindingId: string;
  represents: TargetRepresentation;
  evidence: ApprovalEvidence;
}, dependencies: PersonalityGuardDependencies & { now?: () => number } = {}) {
  return withPersonalityWritingGuard((guard, tx) => {
    const binding = stampVariantPersonality({
      guard,
      bindingId: input.bindingId,
    });
    if (
      input.evidence.kind === "thread_message"
      && input.evidence.workspaceSlug !== binding.workspaceSlug
    ) {
      throw new AgentToolError("VALIDATION_ERROR", "Target evidence belongs to another workspace", {
        reason: "workspace_mismatch",
      });
    }
    const target = guard.targets.get(input.targetId);
    if (!target || target.status !== "active") {
      throw new AgentToolError("NOT_FOUND", `Platform target not found: ${input.targetId}`);
    }
    if (
      input.represents.kind !== "unbound"
      && !isTargetRepresentationCompatible(input.represents, binding.identity)
    ) {
      throw new AgentToolError(
        "CONFLICT",
        "Target representation does not match the active Personality identity",
        { reason: "target_identity_mismatch" },
      );
    }
    const personality = targetPersonalityDecisionSchema.parse({
      schemaVersion: 1,
      represents: input.represents,
      setAt: Math.floor((dependencies.now?.() ?? Date.now()) / 1_000),
      by: "user",
      evidence: input.evidence,
      bindingIdAtDecision: binding.bindingId,
    });
    const metadata = { ...parseMetadataObject(target.metadata), personality };
    tx.update(platformTargets)
      .set({
        metadata: JSON.stringify(metadata),
        updatedAt: personality.setAt,
      })
      .where(eq(platformTargets.id, target.id))
      .run();
    const revokedVariantIds = revokeVariantsForTargetRepresentationWithRunner(
      tx,
      target.id,
      personality.represents,
    );
    const saved = tx.select().from(platformTargets).where(eq(platformTargets.id, target.id)).get()!;
    return {
      target: toPlatformTargetView(saved),
      compatible: isTargetRepresentationCompatible(personality.represents, binding.identity),
      revokedVariantIds,
    };
  }, dependencies);
}
