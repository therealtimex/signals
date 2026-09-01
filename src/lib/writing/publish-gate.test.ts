import { describe, expect, it } from "vitest";
import type { ContentItem, Variant } from "@/lib/db/types";
import { buildWritingUnits, type ContentWritingMetadata } from "@/lib/writing/content-writing";
import {
  evaluateWritingPublishGate,
  WRITING_APPROVAL_REQUIRED,
  WRITING_ARTIFACT_STALE,
} from "@/lib/writing/publish-gate";
import { personalitySourceStaleFinding } from "@/lib/writing/personality-lineage";

function fixture() {
  const units = buildWritingUnits(["A", "B", "C"]);
  const item = {
    id: "content_1",
    status: "approved",
    contentType: "thread",
    platformTarget: "x",
  } as ContentItem;
  const writing: ContentWritingMetadata = {
    schemaVersion: 1,
    surface: "x/thread",
    capability: { publish: "direct" },
    units,
    variantId: "variant_1",
    targetId: "target_1",
    materialization: {
      auditId: "audit_1",
      inputHash: "hash_1",
      approvalAt: 10,
      approvalBy: "user",
    },
  };
  const variant = {
    id: "variant_1",
    metadata: JSON.stringify({
      writing: {
        audit: { id: "audit_1", inputHash: "hash_1", verdict: "pass" },
        approval: { state: "approved", at: 10, by: "user", auditId: "audit_1" },
        units,
        targetId: "target_1",
      },
    }),
  } as Variant;
  return { item, writing, variant };
}

function personalitySnapshot() {
  return {
    schemaVersion: 1 as const,
    bindingId: "pb_binding1",
    personalityHash: "a".repeat(64),
    bindingSourceHash: "b".repeat(64),
    workspaceSlug: "signals",
    workspaceId: null,
    workspaceKey: "workspace-key",
    identity: { selfContactId: "self-1", representedOrgId: null },
    target: null,
  };
}

describe("writing publish gate", () => {
  it("returns the persisted ordered units for a current approval", () => {
    expect(evaluateWritingPublishGate(fixture())).toEqual({
      ok: true,
      payload: { text: "A", threadTexts: ["B", "C"] },
    });
  });

  it("rejects missing and revoked approval even if the item row says approved", () => {
    const missing = fixture();
    delete missing.writing.materialization;
    expect(evaluateWritingPublishGate(missing)).toMatchObject({
      ok: false,
      code: WRITING_APPROVAL_REQUIRED,
    });

    const revoked = fixture();
    const metadata = JSON.parse(revoked.variant.metadata ?? "{}");
    metadata.writing.approval.state = "revoked";
    revoked.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(revoked)).toMatchObject({
      ok: false,
      code: WRITING_APPROVAL_REQUIRED,
    });
  });

  it("rejects an approved state without complete decision evidence", () => {
    const incomplete = fixture();
    const metadata = JSON.parse(incomplete.variant.metadata ?? "{}");
    delete metadata.writing.approval.at;
    delete metadata.writing.approval.by;
    delete metadata.writing.approval.auditId;
    incomplete.variant.metadata = JSON.stringify(metadata);

    expect(evaluateWritingPublishGate(incomplete)).toMatchObject({
      ok: false,
      code: WRITING_APPROVAL_REQUIRED,
    });
  });

  it.each([
    ["auditId", (value: ReturnType<typeof fixture>) => (value.writing.materialization!.auditId = "other")],
    ["inputHash", (value: ReturnType<typeof fixture>) => (value.writing.materialization!.inputHash = "other")],
    ["approvalAt", (value: ReturnType<typeof fixture>) => (value.writing.materialization!.approvalAt = 11)],
    ["approvalBy", (value: ReturnType<typeof fixture>) => (value.writing.materialization!.approvalBy = "agent")],
    ["units", (value: ReturnType<typeof fixture>) => (value.writing.units = buildWritingUnits(["changed"]))],
    ["targetId", (value: ReturnType<typeof fixture>) => (value.writing.targetId = "other")],
  ])("rejects a stale %s snapshot", (_name, mutate) => {
    const value = fixture();
    mutate(value);
    expect(evaluateWritingPublishGate(value)).toMatchObject({
      ok: false,
      code: WRITING_ARTIFACT_STALE,
    });
  });

  it("requires the exact Personality snapshot and audit lineage for bound content", () => {
    const value = fixture();
    const personality = personalitySnapshot();
    value.writing.personality = personality;
    const metadata = JSON.parse(value.variant.metadata ?? "{}");
    metadata.writing.personality = personality;
    metadata.writing.audit.personality = {
      ...personality,
      currentSourceHash: personality.bindingSourceHash,
      statusAtAudit: "bound",
    };
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({ ok: true });

    delete metadata.writing.audit.personality;
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({
      ok: false,
      code: WRITING_ARTIFACT_STALE,
      reason: "Personality audit snapshot is missing",
    });

    metadata.writing.audit.personality = {
      ...personality,
      currentSourceHash: personality.bindingSourceHash,
      statusAtAudit: "bound",
    };
    metadata.writing.personality = { ...personality, bindingId: "pb_binding2" };
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({
      ok: false,
      code: WRITING_ARTIFACT_STALE,
      reason: "Personality snapshot mismatch",
    });
  });

  it("requires deterministic warning and fresh evidence for source-stale approval", () => {
    const value = fixture();
    const personality = personalitySnapshot();
    value.writing.personality = personality;
    const metadata = JSON.parse(value.variant.metadata ?? "{}");
    metadata.writing.personality = personality;
    metadata.writing.audit.personality = {
      ...personality,
      currentSourceHash: "c".repeat(64),
      statusAtAudit: "source_stale",
    };
    metadata.writing.audit.findings = [personalitySourceStaleFinding({
      bindingSourceHash: personality.bindingSourceHash,
      currentSourceHash: "c".repeat(64),
    })];
    metadata.writing.approval.by = "user";
    metadata.writing.approval.evidence = { kind: "ui", route: "/dashboard/content" };
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({ ok: true });

    delete metadata.writing.approval.evidence;
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({
      ok: false,
      code: WRITING_APPROVAL_REQUIRED,
    });

    metadata.writing.approval.evidence = { kind: "ui", route: "/dashboard/content" };
    metadata.writing.audit.findings[0].evidence = "forged";
    value.variant.metadata = JSON.stringify(metadata);
    expect(evaluateWritingPublishGate(value)).toMatchObject({
      ok: false,
      code: WRITING_ARTIFACT_STALE,
    });
  });
});
