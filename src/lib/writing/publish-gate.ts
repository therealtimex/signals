import type { ContentItem, Variant } from "@/lib/db/types";
import {
  deriveWritingPublishText,
  type ContentWritingMetadata,
} from "@/lib/writing/content-writing";
import { readVariantWritingProjection } from "@/lib/writing/variant-writing-projection";

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
  if (projection.approval?.state !== "approved") {
    return approvalRequired("Linked variant approval is missing or revoked.");
  }
  if (!projection.audit) return approvalRequired("Linked variant audit is missing.");

  const snapshot = writing.materialization;
  if (snapshot.auditId !== projection.audit.id) return stale("auditId mismatch");
  if (snapshot.inputHash !== projection.audit.inputHash) return stale("inputHash mismatch");
  if (snapshot.approvalAt !== projection.approval.at) return stale("approvalAt mismatch");
  if (snapshot.approvalBy !== projection.approval.by) return stale("approvalBy mismatch");
  if (projection.approval.auditId !== projection.audit.id) return stale("approval auditId mismatch");
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

  return { ok: true, payload: deriveWritingPublishText(writing, item) };
}
