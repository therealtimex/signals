import { describe, expect, it } from "vitest";
import { contactDisplayInitials } from "@/lib/contact-avatar-client";

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
