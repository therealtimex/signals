import { describe, expect, it } from "vitest";
import type { ContentItem, Variant } from "@/lib/db/types";
import { buildWritingUnits, type ContentWritingMetadata } from "@/lib/writing/content-writing";
import {
  evaluateWritingPublishGate,
  WRITING_APPROVAL_REQUIRED,
  WRITING_ARTIFACT_STALE,
} from "@/lib/writing/publish-gate";

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
});
