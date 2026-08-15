import { VARIANT_STATUSES } from "@/lib/db/gtm-status";

export const VARIANT_DIALOG_STATUSES = VARIANT_STATUSES.filter(
  (status): status is "draft" | "selected" | "rejected" =>
    status === "draft" || status === "selected" || status === "rejected",
);

export function resolveVariantEditBody(body: string): string | null {
  return body.trim() ? body.trim() : null;
}

export function canSubmitVariantDialog(input: {
  editVariantId?: string | null;
  loadedEditVariantId: string | null;
  loadError: string | null;
  loading: boolean;
}): boolean {
  if (input.loading) return false;
  if (!input.editVariantId) return true;
  return input.loadedEditVariantId === input.editVariantId && input.loadError === null;
}

export function isVariantDialogFieldsDisabled(input: {
  loading: boolean;
  editVariantId?: string | null;
  canSubmit: boolean;
}): boolean {
  return input.loading || (Boolean(input.editVariantId) && !input.canSubmit);
}

export function resolveVariantSaveErrorMessage(
  response: { error?: string } | null,
  fallback = "Failed to save variant",
): string {
  return response?.error ?? fallback;
}

export function buildVariantSavePayload(input: {
  label: string;
  variantType: string;
  body: string;
  status: string;
  isEdit: boolean;
  isSimulatedCurrent: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    label: input.label.trim() ? input.label.trim() : null,
    variantType: input.variantType,
    body: resolveVariantEditBody(input.body),
  };

  if (
    !input.isEdit ||
    !input.isSimulatedCurrent ||
    input.status !== "simulated"
  ) {
    const nextStatus = VARIANT_DIALOG_STATUSES.includes(
      input.status as (typeof VARIANT_DIALOG_STATUSES)[number],
    )
      ? input.status
      : input.isSimulatedCurrent
        ? undefined
        : input.status;
    if (nextStatus !== undefined) {
      payload.status = nextStatus;
    }
  }

  return payload;
}
