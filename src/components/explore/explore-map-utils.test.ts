import { describe, expect, it } from "vitest";
import {
  contactNodeVal,
  EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX,
  EXPLORE_MAP_OWNER_NODE_VAL,
  nicheNodeVal,
  nicheTypeColor,
} from "@/components/explore/explore-map-utils";

describe("explore-map-utils", () => {
  it("keeps the owner larger than any audience node", () => {
    expect(contactNodeVal(null, true)).toBe(EXPLORE_MAP_OWNER_NODE_VAL);
    expect(contactNodeVal(10_000_000, false)).toBe(EXPLORE_MAP_AUDIENCE_NODE_VAL_MAX);
    expect(contactNodeVal(null, true)).toBeGreaterThan(contactNodeVal(10_000_000, false));
  });

  it("maps niche types to chart tokens", () => {
    expect(nicheTypeColor("interest")).toContain("chart");
    expect(nicheNodeVal(10)).toBeGreaterThan(0);
  });
});
