import { describe, expect, it } from "vitest";
import { VARIANT_STATUSES } from "@/lib/db/gtm-status";
import {
  VARIANT_DIALOG_STATUSES,
  buildVariantSavePayload,
  canSubmitVariantDialog,
  isVariantDialogFieldsDisabled,
  resolveVariantEditBody,
  resolveVariantSaveErrorMessage,
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

  it("blocks edit submit until the current variant loads successfully", () => {
    expect(
      canSubmitVariantDialog({
        editVariantId: "variant-1",
        loadedEditVariantId: null,
        loadError: null,
        loading: true,
      }),
    ).toBe(false);

    expect(
      canSubmitVariantDialog({
        editVariantId: "variant-1",
        loadedEditVariantId: null,
        loadError: "Failed to load variant",
        loading: false,
      }),
    ).toBe(false);

    expect(
      canSubmitVariantDialog({
        editVariantId: "variant-1",
        loadedEditVariantId: "variant-2",
        loadError: null,
        loading: false,
      }),
    ).toBe(false);

    expect(
      canSubmitVariantDialog({
        editVariantId: "variant-1",
        loadedEditVariantId: "variant-1",
        loadError: null,
        loading: false,
      }),
    ).toBe(true);
  });

  it("keeps loaded edit fields enabled and retryable after a save error", () => {
    const canSubmit = canSubmitVariantDialog({
      editVariantId: "variant-1",
      loadedEditVariantId: "variant-1",
      loadError: null,
      loading: false,
    });

    expect(canSubmit).toBe(true);
    expect(
      isVariantDialogFieldsDisabled({
        loading: false,
        editVariantId: "variant-1",
        canSubmit,
      }),
    ).toBe(false);
  });

  it("preserves server save error messages and maps rejected saves to a fallback", () => {
    expect(resolveVariantSaveErrorMessage({ error: "Published variants are read-only" })).toBe(
      "Published variants are read-only",
    );
    expect(resolveVariantSaveErrorMessage(null)).toBe("Failed to save variant");
  });
});
