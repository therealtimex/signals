import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  extractTakeoutContactsFromZip,
  findTakeoutCsvEntry,
  findTakeoutVcfEntries,
} from "@/lib/platforms/gmail/zip-import";

const SAMPLE_VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
EMAIL:jane@example.com
END:VCARD`;

const SAMPLE_CSV = `First Name,Last Name,E-mail 1 - Value,Organization Name
Jane,Doe,jane@example.com,Acme`;

function makeZip(files: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) {
    encoded[name] = new TextEncoder().encode(contents);
  }
  return zipSync(encoded);
}

describe("findTakeoutCsvEntry", () => {
  it("prefers All Contacts.csv over group exports", () => {
    expect(
      findTakeoutCsvEntry([
        "Takeout/Contacts/Family/Family.csv",
        "Takeout/Contacts/All Contacts/All Contacts.csv",
        "Takeout/Contacts/My Contacts/My Contacts.csv",
      ])
    ).toBe("Takeout/Contacts/All Contacts/All Contacts.csv");
  });

  it("falls back to My Contacts.csv when All Contacts is missing", () => {
    expect(
      findTakeoutCsvEntry([
        "Takeout/Contacts/Family/Family.csv",
        "Takeout/Contacts/My Contacts/My Contacts.csv",
      ])
    ).toBe("Takeout/Contacts/My Contacts/My Contacts.csv");
  });
});

describe("findTakeoutVcfEntries", () => {
  it("sorts Contacts paths before other vcf files", () => {
    expect(
      findTakeoutVcfEntries(["misc/jane.vcf", "Takeout/Contacts/My Contacts.vcf"])
    ).toEqual(["Takeout/Contacts/My Contacts.vcf", "misc/jane.vcf"]);
  });
});

describe("extractTakeoutContactsFromZip", () => {
  it("extracts CSV contacts from a modern Google Takeout archive", () => {
    const zip = makeZip({
      "Takeout/Contacts/All Contacts/All Contacts.csv": SAMPLE_CSV,
      "Takeout/Contacts/All Contacts/photo.jpg": "binary",
    });

    expect(extractTakeoutContactsFromZip(zip)).toBe(SAMPLE_CSV);
  });

  it("extracts vCard contacts from legacy Takeout archives", () => {
    const zip = makeZip({
      "Takeout/Contacts/My Contacts.vcf": SAMPLE_VCARD,
    });

    expect(extractTakeoutContactsFromZip(zip)).toBe(SAMPLE_VCARD);
  });

  it("prefers vCard when both vCard and CSV are present", () => {
    const zip = makeZip({
      "Takeout/Contacts/All Contacts/All Contacts.csv": SAMPLE_CSV,
      "Takeout/Contacts/My Contacts.vcf": SAMPLE_VCARD,
    });

    expect(extractTakeoutContactsFromZip(zip)).toBe(SAMPLE_VCARD);
  });

  it("throws when no contact files are present", () => {
    const zip = makeZip({
      "Takeout/Contacts/All Contacts/photo.jpg": "binary",
    });

    expect(() => extractTakeoutContactsFromZip(zip)).toThrow(/\.vcf or \.csv/);
  });

  it("throws on invalid zip bytes", () => {
    expect(() => extractTakeoutContactsFromZip(new Uint8Array([1, 2, 3]))).toThrow(
      /Invalid zip archive/
    );
  });
});
