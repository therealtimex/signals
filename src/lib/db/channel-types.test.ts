import { describe, expect, it } from "vitest";
import {
  assertChannelType,
  normalizeChannelValue,
} from "@/lib/db/channel-types";

describe("channel-types", () => {
  it("normalizes email to lowercase trimmed", () => {
    expect(normalizeChannelValue("email", "  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("preserves plus-tags in email addresses", () => {
    expect(normalizeChannelValue("email", "a+b@x.com")).toBe("a+b@x.com");
  });

  it("normalizes phone numbers to digits", () => {
    expect(normalizeChannelValue("phone", "(555) 123-4567")).toBe("5551234567");
    expect(normalizeChannelValue("phone", "+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("normalizes messenger handles", () => {
    expect(normalizeChannelValue("telegram", "@Alice")).toBe("alice");
    expect(normalizeChannelValue("discord", "  Bob#1234 ")).toBe("bob#1234");
  });

  it("rejects unknown channel types", () => {
    expect(() => assertChannelType("fax")).toThrow(/Invalid channel type/);
  });
});
