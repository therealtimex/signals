import { describe, expect, it } from "vitest";
import { INTERACTION_TYPES, assertInteractionType } from "@/lib/db/interaction-types";

describe("interaction types", () => {
  it("accepts registry values", () => {
    for (const type of INTERACTION_TYPES) {
      expect(assertInteractionType(type)).toBe(type);
    }
  });

  it("rejects unknown types with allowed list", () => {
    expect(() => assertInteractionType("unknown_type")).toThrow(/Allowed types:/);
  });
});
