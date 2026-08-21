import { describe, expect, it } from "vitest";
import {
  formatPlatformHandle,
  normalizePlatformHandle,
} from "@/lib/contact-identity-handle";

describe("formatPlatformHandle", () => {
  it("adds exactly one sigil to an X handle regardless of how it was stored", () => {
    expect(formatPlatformHandle("x", "chickadeedee3")).toBe("@chickadeedee3");
    // Rows written before the convention was enforced still carry the sigil.
    expect(formatPlatformHandle("x", "@chickadeedee3")).toBe("@chickadeedee3");
    // And the rendering bug this replaces could persist a doubled one.
    expect(formatPlatformHandle("x", "@@chickadeedee3")).toBe("@chickadeedee3");
    expect(formatPlatformHandle("x", "  @sama  ")).toBe("@sama");
  });

  it("never prefixes a platform that does not use the sigil", () => {
    expect(formatPlatformHandle("gmail", "+bui.viet.hien@undp.org"))
      .toBe("+bui.viet.hien@undp.org");
    expect(formatPlatformHandle("linkedin", "nguyen-k-phung-cfa")).toBe("nguyen-k-phung-cfa");
    expect(formatPlatformHandle("linkedin", "/in/name")).toBe("/in/name");
    expect(formatPlatformHandle("youtube", "somechannel")).toBe("somechannel");
  });

  it("returns an empty string for blank input so callers can fall back", () => {
    expect(formatPlatformHandle("x", "")).toBe("");
    expect(formatPlatformHandle("x", "   ")).toBe("");
    expect(formatPlatformHandle("x", "@")).toBe("");
    expect(formatPlatformHandle("gmail", "  ")).toBe("");
  });
});

describe("normalizePlatformHandle", () => {
  it("strips X sigils down to the bare identifier", () => {
    expect(normalizePlatformHandle("x", "@sama")).toBe("sama");
    expect(normalizePlatformHandle("x", "@@sama")).toBe("sama");
    expect(normalizePlatformHandle("x", "sama")).toBe("sama");
  });

  it("leaves an embedded @ alone — a Gmail handle is an address, not a sigil", () => {
    expect(normalizePlatformHandle("gmail", "someone@example.com")).toBe("someone@example.com");
    expect(normalizePlatformHandle("linkedin", "/in/name")).toBe("/in/name");
  });
});
