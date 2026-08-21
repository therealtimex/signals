import { describe, expect, it } from "vitest";
import {
  MAX_TAG_COUNT,
  clampSlider,
  normalizeIdList,
  normalizeTagList,
  toFiniteNumber,
} from "@/lib/workflows/template-field-utils";

const BOUNDS = { min: 5, max: 60, step: 5, fallback: 15 };

describe("clampSlider", () => {
  it("snaps to the step grid and clamps into range", () => {
    expect(clampSlider(BOUNDS, 17)).toBe(15);
    expect(clampSlider(BOUNDS, 3)).toBe(5);
    expect(clampSlider(BOUNDS, 999)).toBe(60);
  });

  it("falls back for unusable values but keeps a legitimate zero", () => {
    expect(clampSlider(BOUNDS, "not a number")).toBe(15);
    expect(clampSlider(BOUNDS, null)).toBe(15);
    expect(clampSlider({ min: 0, max: 3, step: 1, fallback: 1 }, 0)).toBe(0);
  });

  it("accepts numeric strings from range inputs", () => {
    expect(clampSlider(BOUNDS, "30")).toBe(30);
  });
});

describe("normalizeTagList", () => {
  it("trims, drops blanks, and de-duplicates case-insensitively", () => {
    expect(normalizeTagList([" Codex VN ", "codex vn", "", "  ", "Vibe Code"])).toEqual([
      "Codex VN",
      "Vibe Code",
    ]);
  });

  it("splits comma-separated strings", () => {
    expect(normalizeTagList("recommend, alternative ,token")).toEqual([
      "recommend",
      "alternative",
      "token",
    ]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: MAX_TAG_COUNT + 5 }, (_, i) => `tag${i}`);
    expect(normalizeTagList(many)).toHaveLength(MAX_TAG_COUNT);
  });

  it("returns an empty list for unusable input", () => {
    expect(normalizeTagList(undefined)).toEqual([]);
    expect(normalizeTagList([1, null, {}])).toEqual([]);
  });
});

describe("normalizeIdList", () => {
  it("de-duplicates on the exact id instead of folding case", () => {
    // Record ids are opaque — collapsing `tgt_A` into `tgt_a` would silently drop a selection.
    expect(normalizeIdList([" tgt_a ", "tgt_a", "tgt_A"], 10)).toEqual(["tgt_a", "tgt_A"]);
  });

  it("caps the list at the supplied maximum", () => {
    expect(normalizeIdList(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("returns an empty list for unusable input", () => {
    expect(normalizeIdList(undefined, 10)).toEqual([]);
    expect(normalizeIdList([3, null], 10)).toEqual([]);
  });
});

describe("toFiniteNumber", () => {
  it("rejects everything that is not a finite number", () => {
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber("2.5")).toBe(2.5);
  });
});
