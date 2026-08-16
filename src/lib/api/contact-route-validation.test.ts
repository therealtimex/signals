import { describe, expect, it } from "vitest";
import {
  DEPRECATED_PLATFORM_FIELDS_MESSAGE,
  INVALID_JSON_BODY_MESSAGE,
  UNSUPPORTED_IDENTITY_UPDATE_MESSAGE,
  getDeprecatedPlatformFieldsError,
  getInvalidJsonBodyError,
  getUnsupportedIdentityFieldsError,
} from "@/lib/api/contact-route-validation";

describe("contact-route-validation", () => {
  it("rejects non-object JSON roots", () => {
    expect(getInvalidJsonBodyError(null)).toBe(INVALID_JSON_BODY_MESSAGE);
    expect(getInvalidJsonBodyError("string")).toBe(INVALID_JSON_BODY_MESSAGE);
    expect(getInvalidJsonBodyError([])).toBe(INVALID_JSON_BODY_MESSAGE);
  });

  it("detects deprecated platform fields safely", () => {
    expect(getDeprecatedPlatformFieldsError(null)).toBe(INVALID_JSON_BODY_MESSAGE);
    expect(getDeprecatedPlatformFieldsError({ platform: "x" })).toBe(
      DEPRECATED_PLATFORM_FIELDS_MESSAGE,
    );
  });

  it("detects unsupported identity fields on update", () => {
    expect(getUnsupportedIdentityFieldsError({ identity: { platform: "x" } })).toBe(
      UNSUPPORTED_IDENTITY_UPDATE_MESSAGE,
    );
    expect(getUnsupportedIdentityFieldsError({ name: "Ada" })).toBeNull();
  });
});
