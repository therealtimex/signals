import { describe, expect, it } from "vitest";
import { contactDisplayInitials, validateIdentityAvatarUrl } from "@/lib/contact-avatar-client";

describe("contactDisplayInitials", () => {
  it("uses first and last name when both are present", () => {
    expect(contactDisplayInitials({ firstName: "Jane", lastName: "Doe" })).toBe("JD");
  });

  it("falls back to display name tokens", () => {
    expect(contactDisplayInitials({ name: "Ada Lovelace" })).toBe("AL");
  });

  it("returns a placeholder when no name is available", () => {
    expect(contactDisplayInitials({})).toBe("?");
  });
});

describe("validateIdentityAvatarUrl", () => {
  it("accepts http(s) platform URLs", () => {
    expect(validateIdentityAvatarUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  it("rejects local file paths", () => {
    expect(() => validateIdentityAvatarUrl("file:///tmp/avatar.jpg")).toThrow(/upload-avatar/);
    expect(() => validateIdentityAvatarUrl("/Users/me/avatar.jpg")).toThrow(/upload-avatar/);
  });
});
