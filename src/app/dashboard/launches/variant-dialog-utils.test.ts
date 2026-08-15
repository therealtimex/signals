import { describe, expect, it } from "vitest";
import { VARIANT_STATUSES } from "@/lib/db/gtm-status";
import {
  VARIANT_DIALOG_STATUSES,
  buildVariantSavePayload,
  resolveVariantEditBody,
} from "@/app/dashboard/launches/variant-dialog-utils";

describe("variant dialog utils", () => {
  it("derives dialog statuses from VARIANT_STATUSES", () => {
    expect(VARIANT_DIALOG_STATUSES).toEqual(["draft", "selected", "rejected"]);
    for (const status of VARIANT_DIALOG_STATUSES) {
      expect(VARIANT_STATUSES).toContain(status);
    }
  });

  it("sends explicit null when edit body is cleared", () => {
    expect(resolveVariantEditBody("  hello  ")).toBe("hello");
    expect(resolveVariantEditBody("   ")).toBeNull();
    expect(buildVariantSavePayload({
      label: "A",
      variantType: "post",
      body: "   ",
      status: "draft",
      isEdit: true,
      isSimulatedCurrent: false,
    })).toMatchObject({
      body: null,
    });
  });

  it("omits status when simulated variant is unchanged", () => {
    expect(
      buildVariantSavePayload({
        label: "A",
        variantType: "post",
        body: "copy",
        status: "simulated",
        isEdit: true,
        isSimulatedCurrent: true,
      }),
    ).toEqual({
      label: "A",
      variantType: "post",
      body: "copy",
    });
  });
});
