import { describe, expect, it } from "vitest";
import {
  compatibleTargetIds,
  isTargetRepresentationCompatible,
  mergeTargetPersonalityMetadata,
  projectTargetRepresentation,
  targetPersonalityDecisionSchema,
} from "@/lib/personality/target-representation";

function decision(
  represents:
    | { kind: "unbound" }
    | { kind: "self"; contactId: string }
    | { kind: "org"; orgId: string },
) {
  return targetPersonalityDecisionSchema.parse({
    schemaVersion: 1,
    represents,
    setAt: 1,
    by: "user",
    evidence: { kind: "ui", route: "/settings/personality" },
    bindingIdAtDecision: "pb_binding1",
  });
}

describe("Personality target representation", () => {
  it.each([
    {},
    { personality: "self" },
    { personality: { schemaVersion: 99 } },
    "invalid-json",
  ])("projects legacy or invalid metadata as unbound", (metadata) => {
    expect(projectTargetRepresentation({ metadata })).toEqual({
      represents: { kind: "unbound" },
      personalityDecision: null,
    });
  });

  it("matches only the exact concrete self or represented organization", () => {
    const identity = { selfContactId: "self-1", representedOrgId: "org-1" };
    expect(isTargetRepresentationCompatible({ kind: "self", contactId: "self-1" }, identity)).toBe(true);
    expect(isTargetRepresentationCompatible({ kind: "self", contactId: "self-2" }, identity)).toBe(false);
    expect(isTargetRepresentationCompatible({ kind: "org", orgId: "org-1" }, identity)).toBe(true);
    expect(isTargetRepresentationCompatible({ kind: "org", orgId: "org-2" }, identity)).toBe(false);
    expect(isTargetRepresentationCompatible({ kind: "unbound" }, identity)).toBe(false);
  });

  it("lists only active compatible target ids in deterministic order", () => {
    const identity = { selfContactId: "self-1", representedOrgId: null };
    expect(compatibleTargetIds([
      { id: "target-b", status: "active", metadata: { personality: decision({ kind: "self", contactId: "self-1" }) } },
      { id: "target-a", status: "active", metadata: { personality: decision({ kind: "self", contactId: "self-1" }) } },
      { id: "target-other", status: "active", metadata: { personality: decision({ kind: "self", contactId: "self-2" }) } },
      { id: "target-forgotten", status: "forgotten", metadata: { personality: decision({ kind: "self", contactId: "self-1" }) } },
    ], identity)).toEqual(["target-a", "target-b"]);
  });

  it("preserves a concrete alias decision and rejects incompatible concrete merges", () => {
    const self = decision({ kind: "self", contactId: "self-1" });
    const org = decision({ kind: "org", orgId: "org-1" });
    expect(mergeTargetPersonalityMetadata(
      { source: "primary" },
      { source: "alias", personality: self },
    )).toMatchObject({ source: "primary", personality: self });
    expect(() => mergeTargetPersonalityMetadata(
      { personality: self },
      { personality: org },
    )).toThrow(/incompatible Personality representations/);
  });
});
