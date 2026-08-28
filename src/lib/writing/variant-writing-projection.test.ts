import { describe, expect, it } from "vitest";
import {
  readVariantWritingProjection,
  type VariantWritingProjection,
} from "@/lib/writing/variant-writing-projection";

type AcceptedVariantWritingContract = {
  audit: {
    id: string;
    inputHash: string;
    verdict: string;
    findings: unknown[];
  } | null;
  approval: {
    schemaVersion: 1;
    state: "pending" | "approved" | "rejected" | "revoked";
    riskTier: "low" | "medium" | "high";
    policy: "explicit" | "auto_low_risk";
    auditId?: `aud_${string}`;
    by?: "user" | "policy";
    at?: number;
  };
  units: { texts: string[]; count: number; chars: number[] };
  targetId?: string;
  platform: string;
  surface: string;
};

type FullContractIsAccepted = AcceptedVariantWritingContract extends VariantWritingProjection
  ? true
  : false;

describe("variant writing projection", () => {
  it("reads only the narrow approval/audit seam and preserves future fields", () => {
    const projection = readVariantWritingProjection({
      metadata: JSON.stringify({
        writing: {
          audit: { id: "aud_1", inputHash: "hash", verdict: "pass", findings: [] },
          approval: { state: "approved", at: 10, by: "user", auditId: "aud_1" },
          units: { texts: ["A"], count: 1, chars: [1] },
          future: true,
        },
      }),
    });
    expect(projection).toMatchObject({
      audit: { id: "aud_1", inputHash: "hash" },
      approval: { state: "approved" },
      future: true,
    });
  });

  it.each(["pending", "rejected", "revoked"] as const)(
    "accepts the full %s approval state without decision evidence",
    (state) => {
      const projection = readVariantWritingProjection({
        metadata: {
          writing: {
            audit: null,
            approval: {
              schemaVersion: 1,
              state,
              riskTier: "high",
              policy: "explicit",
            },
            units: { texts: ["A"], count: 1, chars: [1] },
            platform: "x",
            surface: "x/post",
          },
        },
      });

      expect(projection?.approval).toMatchObject({ state });
      expect(projection).toMatchObject({ platform: "x", surface: "x/post" });
    },
  );

  it("keeps the full accepted VariantWriting contract assignable to the projection seam", () => {
    const fullContractIsAccepted: FullContractIsAccepted = true;
    expect(fullContractIsAccepted).toBe(true);
  });

  it("returns null for an incomplete projection", () => {
    expect(readVariantWritingProjection({ metadata: "{}" })).toBeNull();
    expect(
      readVariantWritingProjection({
        metadata: JSON.stringify({ writing: { audit: { id: "missing-fields" } } }),
      }),
    ).toBeNull();
  });
});
