import { describe, expect, it } from "vitest";
import { readVariantWritingProjection } from "@/lib/writing/variant-writing-projection";

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

  it("returns null for an incomplete projection", () => {
    expect(readVariantWritingProjection({ metadata: "{}" })).toBeNull();
    expect(
      readVariantWritingProjection({
        metadata: JSON.stringify({ writing: { audit: { id: "missing-fields" } } }),
      }),
    ).toBeNull();
  });
});
