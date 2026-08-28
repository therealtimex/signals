import { describe, expect, it } from "vitest";
import { calculateRelationshipStrength } from "./relationship-strength";

const now = 2_000_000_000;

describe("relationship strength", () => {
  it("returns unknown when there is no evidence", () => {
    expect(calculateRelationshipStrength({ now })).toMatchObject({ score: null, band: "unknown" });
  });

  it("renormalizes around the components that are present", () => {
    expect(calculateRelationshipStrength({ warmth: 80, now })).toMatchObject({
      score: 80,
      band: "strong",
    });
  });

  it("scores recency, frequency, reciprocity, and connection deterministically", () => {
    const interactions = [
      { occurredAt: now - 3 * 86_400, direction: "inbound" as const, communication: true, meaningful: true },
      { occurredAt: now - 20 * 86_400, direction: "outbound" as const, communication: true, meaningful: false },
    ];
    const result = calculateRelationshipStrength({ interactions, connection: "connected", now });
    expect(result.components.map((component) => [component.key, component.value])).toEqual([
      ["recency", 100],
      ["frequency", 20],
      ["reciprocity", 100],
      ["connection", 100],
    ]);
    expect(result.band).toBe("strong");
  });
});
