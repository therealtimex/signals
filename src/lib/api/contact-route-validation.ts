export const INVALID_JSON_BODY_MESSAGE = "Request body must be a JSON object";

export const DEPRECATED_PLATFORM_FIELDS_MESSAGE =
  "Deprecated fields platform/platformUserId are not accepted. Use identity or identities instead.";

export const UNSUPPORTED_IDENTITY_UPDATE_MESSAGE =
  "Identity fields identity/identities are not accepted on contact update. Use POST /api/contacts/[id]/identities instead.";

export {
  getImmutableBirthFieldsError,
  IMMUTABLE_BIRTH_FIELDS_MESSAGE,
} from "@/lib/db/creation-provenance-input";

export function isJsonObjectBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

export function getInvalidJsonBodyError(body: unknown): string | null {
  if (!isJsonObjectBody(body)) {
    return INVALID_JSON_BODY_MESSAGE;
  }
  return null;
}

export function getDeprecatedPlatformFieldsError(body: unknown): string | null {
  if (!isJsonObjectBody(body)) {
    return INVALID_JSON_BODY_MESSAGE;
  }
  if ("platform" in body || "platformUserId" in body) {
    return DEPRECATED_PLATFORM_FIELDS_MESSAGE;
  }
  return null;
}

export function getUnsupportedIdentityFieldsError(body: unknown): string | null {
  if (!isJsonObjectBody(body)) {
    return INVALID_JSON_BODY_MESSAGE;
  }
  if ("identity" in body || "identities" in body) {
    return UNSUPPORTED_IDENTITY_UPDATE_MESSAGE;
  }
  return null;
}
