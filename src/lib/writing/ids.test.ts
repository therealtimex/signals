import { describe, expect, it } from "vitest";
import { isWritingId, newWritingId, parseFormulaId, parseOverlayId, parseRuleId } from "@/lib/writing/ids";

describe("writing identifiers", () => {
  it("generates namespaced ids and parses closed writing grammars", () => {
    expect(isWritingId("aud", newWritingId("aud"))).toBe(true);
    expect(isWritingId("prp", newWritingId("prp"))).toBe(true);
    expect(isWritingId("pb", newWritingId("pb"))).toBe(true);
    expect(isWritingId("pm", newWritingId("pm"))).toBe(true);
    expect(isWritingId("aud", "aud_short")).toBe(false);
    expect(parseFormulaId("x/post/one-liner@1")).toBe("x/post/one-liner@1");
    expect(parseFormulaId("X1")).toBeNull();
    expect(parseRuleId("core/claim/no-invented-numbers")).toBe("core/claim/no-invented-numbers");
    expect(parseRuleId("x/post/heuristic/hook-before-fold")).toBe("x/post/heuristic/hook-before-fold");
    expect(parseOverlayId("overlay:linkedin@3")).toEqual({ platform: "linkedin", version: 3 });
  });
});
