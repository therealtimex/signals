import { describe, expect, it } from "vitest";
import { buildIntroductionPaths } from "./intro-paths";
import type { RelationshipStrength } from "./relationship-strength";

function strength(score: number | null): RelationshipStrength {
  return {
    score,
    band: score === null ? "unknown" : score >= 60 ? "strong" : score >= 30 ? "moderate" : "weak",
    components: [],
    computedAt: 1,
  };
}

describe("introduction paths", () => {
  it("prefers a direct path and emits an actionable next step", () => {
    const result = buildIntroductionPaths([
      { contactId: "t", name: "Priya", title: "VP", strength: strength(80), direct: true },
    ], []);
    expect(result).toMatchObject({
      coverage: "direct",
      paths: [{ target: { contactId: "t" }, via: [], nextAction: { kind: "reach_out" } }],
    });
  });

  it("ranks a second-degree introduction through the strongest connector", () => {
    const target = { contactId: "t", name: "Priya", title: null, strength: strength(null), direct: false };
    const result = buildIntroductionPaths([target], [
      { targetContactId: "t", via: { contactId: "x", name: "Marco", strength: strength(70) }, connection: "connected" },
      { targetContactId: "t", via: { contactId: "y", name: "Lee", strength: strength(40) }, connection: "follows" },
    ]);
    expect(result.paths[0]).toMatchObject({ via: [{ name: "Marco" }], score: 56 });
  });
});
