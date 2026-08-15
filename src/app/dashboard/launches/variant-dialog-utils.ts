import { VARIANT_STATUSES } from "@/lib/db/gtm-status";

export const VARIANT_DIALOG_STATUSES = VARIANT_STATUSES.filter(
  (status): status is "draft" | "selected" | "rejected" =>
    status === "draft" || status === "selected" || status === "rejected",
);

export function resolveVariantEditBody(body: string): string | null {
  return body.trim() ? body.trim() : null;
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
