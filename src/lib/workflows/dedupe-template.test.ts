import { describe, expect, it } from "vitest";
import {
  DEDUPE_DEFAULT_TIERS,
  buildDedupeRunConfig,
  isDedupeTemplateConfig,
  readDedupeRunControls,
  tierPresetFromTiers,
  tiersFromPreset,
} from "@/lib/workflows/dedupe-template";

describe("dedupe-template", () => {
  it("recognises a dedupe template by its run controls", () => {
    expect(isDedupeTemplateConfig({ tiers: [1, 2], minConfidence: 0.8 })).toBe(true);
    // A renamed copy of the built-in still behaves like one.
    expect(isDedupeTemplateConfig({ tiers: [1] })).toBe(true);
    expect(isDedupeTemplateConfig({ maxContacts: 20, inactivityDays: 365 })).toBe(false);
  });

  it("falls back to the seeded defaults for a malformed config", () => {
    expect(readDedupeRunControls({ tiers: "all", minConfidence: "x" })).toEqual({
      tiers: DEDUPE_DEFAULT_TIERS,
      minConfidence: 0.8,
      limit: 25,
    });
  });

  it("clamps confidence and limit into range", () => {
    const controls = readDedupeRunControls({ tiers: [3], minConfidence: 4, limit: 9999 });
    expect(controls).toEqual({ tiers: [3], minConfidence: 1, limit: 200 });
  });

  it("emits only the dedupe knobs, never the inactivity-prune ones", () => {
    const config = buildDedupeRunConfig({ tiers: [1], minConfidence: 0.9, limit: 10 });
    expect(config).toEqual({ tiers: [1], minConfidence: 0.9, limit: 10 });
    expect(config).not.toHaveProperty("maxContacts");
    expect(config).not.toHaveProperty("inactivityDays");
  });

  it("round-trips tier presets", () => {
    for (const preset of ["1", "1-2", "1-3"] as const) {
      expect(tierPresetFromTiers(tiersFromPreset(preset))).toBe(preset);
    }
    expect(tiersFromPreset("nonsense")).toEqual(DEDUPE_DEFAULT_TIERS);
  });
});
