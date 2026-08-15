/** Open vocabulary for variant formats — extend here as new creative types land. */
export const VARIANT_TYPES = ["post", "thread", "email", "visual"] as const;

export type VariantType = (typeof VARIANT_TYPES)[number];

export function isVariantType(value: string): value is VariantType {
  return (VARIANT_TYPES as readonly string[]).includes(value);
}

export function assertVariantType(value: string): VariantType {
  if (!isVariantType(value)) {
    throw new Error(`Invalid variant_type: ${value}`);
  }
  return value;
}
