import { describe, expect, it } from "vitest";
import {
  employmentFoldUpdates,
  normalizeEmploymentTitle,
  pickEmploymentFoldTarget,
  type FoldableEmployment,
} from "@/lib/db/employment-fold";

function row(over: Partial<FoldableEmployment> = {}): FoldableEmployment {
  return { id: "r", title: null, startedAt: null, endedAt: null, isCurrent: false, ...over };
}

describe("pickEmploymentFoldTarget", () => {
  it("folds on an equal title, ignoring case and padding", () => {
    const target = row({ id: "kept", title: "Engineer" });
    expect(pickEmploymentFoldTarget(row({ title: "  engineer " }), [target])?.id).toBe("kept");
  });

  it("folds when either side is blank — less detail is not a second job", () => {
    expect(pickEmploymentFoldTarget(row({ title: null }), [row({ id: "a", title: "CTO" })])?.id).toBe("a");
    expect(pickEmploymentFoldTarget(row({ title: "CTO" }), [row({ id: "b", title: "" })])?.id).toBe("b");
  });

  it("keeps two distinct non-blank titles apart", () => {
    expect(pickEmploymentFoldTarget(row({ title: "CTO" }), [row({ title: "Engineer" })])).toBeUndefined();
  });

  it("never folds two rows whose start dates disagree, even on an equal title", () => {
    // The only evidence the data can carry that someone left and returned.
    const target = row({ id: "old", title: "Engineer", startedAt: 100 });
    expect(pickEmploymentFoldTarget(row({ title: "Engineer", startedAt: 200 }), [target])).toBeUndefined();
    // One side undated is not disagreement.
    expect(pickEmploymentFoldTarget(row({ title: "Engineer" }), [target])?.id).toBe("old");
    // Identical dates are the same stint.
    expect(
      pickEmploymentFoldTarget(row({ title: "Engineer", startedAt: 100 }), [target])?.id,
    ).toBe("old");
  });

  it("prefers an exact title match over a blank candidate", () => {
    const blank = row({ id: "blank", title: null });
    const exact = row({ id: "exact", title: "Engineer" });
    expect(pickEmploymentFoldTarget(row({ title: "Engineer" }), [blank, exact])?.id).toBe("exact");
  });
});

describe("employmentFoldUpdates", () => {
  it("fills only what the kept row is missing", () => {
    const updates = employmentFoldUpdates(
      row({ title: null, startedAt: null, endedAt: null, isCurrent: false }),
      row({ title: "CTO", startedAt: 5, endedAt: 9, isCurrent: true }),
    );
    expect(updates).toEqual({ title: "CTO", startedAt: 5, endedAt: 9, isCurrent: true });
  });

  it("never overwrites what the kept row already has", () => {
    const updates = employmentFoldUpdates(
      row({ title: "Founder", startedAt: 1, endedAt: 2, isCurrent: true }),
      row({ title: "CTO", startedAt: 5, endedAt: 9, isCurrent: false }),
    );
    expect(updates).toEqual({});
  });
});

describe("normalizeEmploymentTitle", () => {
  it("treats null, undefined and whitespace as blank", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(normalizeEmploymentTitle(value)).toBe("");
    }
  });
});
