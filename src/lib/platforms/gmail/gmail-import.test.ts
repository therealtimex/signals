import { describe, expect, it } from "vitest";
import { parseTakeoutVcards, parseTakeoutContactsCsv } from "@/lib/platforms/gmail/takeout-parse";
import {
  extractEmailDomain,
  isFreemailDomain,
  orgNameFromDomain,
} from "@/lib/platforms/gmail/email-domain";
import {
  extractEnvelopeAddresses,
  parseEnvelopeTimestamp,
  parseMailAddress,
} from "@/lib/platforms/gmail/address-extract";

describe("takeout-parse", () => {
  it("parses vCard contacts with email and org", () => {
    const text = `BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
EMAIL:jane@rta.vn
ORG:RealtimeX;Engineer
END:VCARD`;

    const rows = parseTakeoutVcards(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("jane@rta.vn");
    expect(rows[0]?.company).toBe("RealtimeX");
    expect(rows[0]?.title).toBe("Engineer");
  });

  it("parses Google Contacts CSV headers", () => {
    const csv = `Name,Given Name,Family Name,E-mail 1 - Value,Organization 1 - Name
Jane Doe,Jane,Doe,jane@example.com,Acme`;

    const rows = parseTakeoutContactsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("jane@example.com");
    expect(rows[0]?.company).toBe("Acme");
  });
});

describe("email-domain", () => {
  it("detects freemail domains", () => {
    expect(isFreemailDomain("gmail.com")).toBe(true);
    expect(isFreemailDomain("rta.vn")).toBe(false);
  });

  it("extracts domain and derives org name", () => {
    expect(extractEmailDomain("jane@rta.vn")).toBe("rta.vn");
    expect(orgNameFromDomain("rta.vn")).toBe("Rta");
  });
});

describe("address-extract", () => {
  it("parses angle-bracket addresses", () => {
    expect(parseMailAddress("Jane <jane@example.com>")).toEqual({
      email: "jane@example.com",
      displayName: "Jane",
    });
  });

  it("extracts addresses from Himalaya envelope JSON", () => {
    const addresses = extractEnvelopeAddresses({
      from: { name: "Alice", addrs: ["alice@example.com"] },
      to: [{ name: "Bob", addrs: ["bob@rta.vn"] }],
      date: "2026-01-15T10:00:00Z",
    });

    expect(addresses.map((row) => row.email).sort()).toEqual([
      "alice@example.com",
      "bob@rta.vn",
    ]);
    expect(parseEnvelopeTimestamp({ date: "2026-01-15T10:00:00Z" })).toBeTypeOf("number");
  });
});
