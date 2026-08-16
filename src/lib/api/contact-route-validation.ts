export const DEPRECATED_PLATFORM_FIELDS_MESSAGE =
  "Deprecated fields platform/platformUserId are not accepted. Use identity or identities instead.";

export function getDeprecatedPlatformFieldsError(
  body: Record<string, unknown>,
): string | null {
  if ("platform" in body || "platformUserId" in body) {
    return DEPRECATED_PLATFORM_FIELDS_MESSAGE;
  }
  return null;
}
