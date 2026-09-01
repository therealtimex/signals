import type { ContentItem, Variant } from "@/lib/db/types";
import {
  deriveWritingPublishText,
  type ContentWritingMetadata,
} from "@/lib/writing/content-writing";
import { readVariantWritingProjection } from "@/lib/writing/variant-writing-projection";
import { getLaunchById } from "@/lib/db/queries/launches";
import { readLaunchWriting } from "@/lib/writing/launch-writing";
import { computeAuditInputHash } from "@/lib/writing/hash";
import { hasExactPersonalitySourceStaleFinding } from "@/lib/writing/personality-lineage";

export const WRITING_APPROVAL_REQUIRED = "WRITING_APPROVAL_REQUIRED";
export const WRITING_ARTIFACT_STALE = "WRITING_ARTIFACT_STALE";

export type WritingPublishGateResult =
  | { ok: true; payload: { text: string; threadTexts?: string[] } }
  | {
      ok: false;
      code: typeof WRITING_APPROVAL_REQUIRED | typeof WRITING_ARTIFACT_STALE;
      reason: string;
    };

function approvalRequired(reason: string): WritingPublishGateResult {
  return { ok: false, code: WRITING_APPROVAL_REQUIRED, reason };
}

function stale(reason: string): WritingPublishGateResult {
  return { ok: false, code: WRITING_ARTIFACT_STALE, reason };
}

export function evaluateWritingPublishGate(args: {
  item: ContentItem;
  writing: ContentWritingMetadata;
  variant: Variant | null;
}): WritingPublishGateResult {
  const { item, writing, variant } = args;
  if (item.status !== "approved") {
    return approvalRequired(
      "Approve and materialize through the writing pipeline; agent drafts cannot be published directly.",
    );
  }
  if (!writing.materialization) return approvalRequired("Materialization snapshot is missing.");
  if (!writing.variantId) return approvalRequired("Linked writing variant is missing.");
  if (!variant) return approvalRequired("Linked writing variant was not found.");

  const projection = readVariantWritingProjection(variant);
  if (!projection) return approvalRequired("Linked variant writing metadata is missing or invalid.");
  const approval = projection.approval;
  if (approval?.state !== "approved") {
    return approvalRequired("Linked variant approval is missing or revoked.");
  }
  if (approval.at === undefined || !approval.by || !approval.auditId) {
    return approvalRequired("Linked approved variant decision metadata is incomplete.");
  }
  if (!projection.audit) return approvalRequired("Linked variant audit is missing.");
  if (item.body != null && item.body !== writing.units.texts[0]) return stale("content body mismatch");
  if (
    projection.schemaVersion === 1 &&
    projection.audit.inputHash !== computeAuditInputHash(variant.body, projection)
  ) {
    return stale("canonical audit input mismatch");
  }
  const launchWriting = readLaunchWriting(getLaunchById(variant.launchId)?.metadata);
  if (
    launchWriting?.spine &&
    projection.spine &&
    (launchWriting.spine.id !== projection.spine.id || launchWriting.spine.hash !== projection.spine.hash)
  ) {
    return stale("launch spine mismatch");
  }

  const snapshot = writing.materialization;
  if (snapshot.auditId !== projection.audit.id) return stale("auditId mismatch");
  if (snapshot.inputHash !== projection.audit.inputHash) return stale("inputHash mismatch");
  if (snapshot.approvalAt !== approval.at) return stale("approvalAt mismatch");
  if (snapshot.approvalBy !== approval.by) return stale("approvalBy mismatch");
  if (approval.auditId !== projection.audit.id) return stale("approval auditId mismatch");
  if (
    projection.units &&
    JSON.stringify(writing.units.texts) !== JSON.stringify(projection.units.texts)
  ) {
    return stale("units mismatch");
  }
  if (
    (writing.targetId !== undefined || projection.targetId !== undefined) &&
    writing.targetId !== projection.targetId
  ) {
    return stale("targetId mismatch");
  }
  if (JSON.stringify(writing.personality ?? null) !== JSON.stringify(projection.personality ?? null)) {
    return stale("Personality snapshot mismatch");
  }
  if (projection.personality && !projection.audit.personality) {
    return stale("Personality audit snapshot is missing");
  }
  if (projection.audit.personality?.statusAtAudit === "source_stale") {
    if (approval.by !== "user" || !approval.evidence) {
      return approvalRequired("Source-stale Personality approval evidence is missing.");
    }
    if (!hasExactPersonalitySourceStaleFinding(projection.audit.findings, {
      bindingSourceHash: projection.audit.personality.bindingSourceHash,
      currentSourceHash: projection.audit.personality.currentSourceHash,
    })) {
      return stale("Personality source-stale warning is missing or invalid");
    }
  }

  return { ok: true, payload: deriveWritingPublishText(writing, item) };
}
