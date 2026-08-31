import { describe, expect, it } from "vitest";
import { canonicalJson, computeAuditInputHash, computeVoiceProfileHash, sha256Canonical } from "@/lib/writing/hash";

describe("writing canonical hashes", () => {
  it("sorts object keys, preserves array order, and omits undefined", () => {
    expect(canonicalJson({ z: 1, a: { d: undefined, c: [2, 1] } })).toBe('{"a":{"c":[2,1]},"z":1}');
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(sha256Canonical({ a: 1, b: 2 }));
    expect(sha256Canonical({ b: 2, a: 1 })).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
    expect(sha256Canonical([1, 2])).not.toBe(sha256Canonical([2, 1]));
  });

  it("excludes lifecycle and prediction fields from writing hashes", () => {
    const writing = { platform: "x", surface: "x/post", goal: "likes", formulaId: "x/post/test@1", overlay: { id: "overlay:x", version: 1 }, core: { version: 1 }, voiceProfile: null, voicePrecedence: "voice_first", spine: { id: "spn_spine01", hash: "h" }, units: { texts: ["A"], count: 1, chars: [1] }, claimMap: [], approval: { state: "approved" }, materializedContentItemId: "one" };
    expect(computeAuditInputHash("A", writing)).toBe(computeAuditInputHash("A", { ...writing, approval: { state: "revoked" }, materializedContentItemId: "two" }));
    expect(computeVoiceProfileHash({ id: "vp_profile1", label: "Me", version: 1, status: "draft", hash: "old" })).toBe(computeVoiceProfileHash({ id: "vp_profile1", label: "Me", version: 9, status: "approved", hash: "new" }));
  });

  it("preserves the legacy hash when Personality is absent and changes it when bound", () => {
    const writing = { platform: "x", surface: "x/post", goal: "likes", formulaId: "x/post/test@1", overlay: { id: "overlay:x", version: 1 }, core: { version: 1 }, voiceProfile: null, voicePrecedence: "voice_first", spine: { id: "spn_spine01", hash: "h" }, units: { texts: ["A"], count: 1, chars: [1] }, claimMap: [] };
    const legacy = computeAuditInputHash("A", writing);
    expect(legacy).toBe(computeAuditInputHash("A", { ...writing, personality: undefined }));
    expect(computeAuditInputHash("A", { ...writing, personality: null })).not.toBe(legacy);
    expect(computeAuditInputHash("A", {
      ...writing,
      personality: { schemaVersion: 1, bindingId: "pb_binding1" },
    })).not.toBe(legacy);
  });
});
