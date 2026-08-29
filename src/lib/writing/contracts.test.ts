import { describe, expect, expectTypeOf, it } from "vitest";
import { evidenceSpineSchema, launchWritingPatchSchema } from "@/lib/writing/contracts";
import type { VariantWriting } from "@/lib/writing/contracts";
import type { ContentWritingMetadata } from "@/lib/writing/content-writing";
import type { VariantWritingProjection } from "@/lib/writing/variant-writing-projection";

describe("writing contracts", () => {
  it("preserves unknown fields and rejects orphan claims/proof refs", () => {
    const base = {
      schemaVersion: 1 as const,
      id: "spn_spine01",
      launchId: "launch",
      goal: "likes" as const,
      audience: { nicheIds: [], future: true },
      sources: [{ id: "src_source1", kind: "note" as const, text: "Fact", enteredAt: 1, sensitivity: { level: "public" as const, reason: "public_default" as const } }],
      claims: [{ id: "clm_claim01", kind: "fact" as const, text: "Fact", sourceId: "src_source1", verbatimRequired: false, sensitivity: "public" as const, includeInOutput: true }],
      message: { core: "Fact", supporting: [], proofClaimIds: ["clm_claim01"] },
      extractedBy: { at: 1 },
      hash: "hash",
      extension: { keep: true },
    };
    expect(evidenceSpineSchema.parse(base).extension).toEqual({ keep: true });
    expect(evidenceSpineSchema.safeParse({ ...base, claims: [{ ...base.claims[0], sourceId: "src_missing1" }] }).success).toBe(false);
    expect(evidenceSpineSchema.safeParse({ ...base, message: { ...base.message, proofClaimIds: ["clm_missing1"] } }).success).toBe(false);
  });

  it("accepts source inputs without agent-computed hashes", () => {
    expect(launchWritingPatchSchema.safeParse({
      sources: [{
        id: "src_source1",
        kind: "url",
        url: "https://example.com/source",
        retrievedAt: 1,
        excerpt: "Evidence",
        sensitivity: { level: "public", reason: "public_default" },
      }],
    }).success).toBe(true);
  });

  it("keeps the full stored contract assignable to its read projections", () => {
    expectTypeOf<VariantWriting>().toMatchTypeOf<VariantWritingProjection>();
    expectTypeOf<ContentWritingMetadata>().toMatchTypeOf<{
      materialization?: { auditId: string; inputHash: string; approvalAt: number; approvalBy: string };
    }>();
  });
});
