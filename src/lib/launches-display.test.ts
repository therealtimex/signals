import { describe, expect, it } from "vitest";
import type { LaunchVariantBoardItem } from "@/lib/db/queries/launches";
import { sortVariantsForBoard } from "@/lib/launches-display";

function boardVariant(
  overrides: Partial<LaunchVariantBoardItem> & Pick<LaunchVariantBoardItem, "id" | "createdAt">,
): LaunchVariantBoardItem {
  return {
    label: null,
    status: "draft",
    predictedScore: null,
    variantType: "post",
    predictionConfidence: null,
    simulatedAt: null,
    contentItemId: null,
    ...overrides,
  };
}

describe("sortVariantsForBoard", () => {
  it("tiebreaks equal scores by createdAt ascending even when ids are opposite order", () => {
    const older = boardVariant({ id: "zzz", createdAt: 100, predictedScore: 10 });
    const newer = boardVariant({ id: "aaa", createdAt: 200, predictedScore: 10 });

    expect(sortVariantsForBoard([newer, older]).map((variant) => variant.id)).toEqual([
      "zzz",
      "aaa",
    ]);
  });
});
