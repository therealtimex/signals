import { describe, it, expect } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  extractConnectionsCsvFromZip,
  findConnectionsCsvEntry,
} from "@/lib/platforms/linkedin/zip-import";

const SAMPLE_CSV = [
  "Notes:",
  '"When exporting your connection data..."',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Jane,Doe,https://www.linkedin.com/in/jane-doe,,Acme,CEO,1 Jan 2026",
].join("\n");

function makeZip(files: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) {
    encoded[name] = new TextEncoder().encode(contents);
  }
  return zipSync(encoded);
}

/** Patch a central-directory compression method (tests only). */
function setEntryCompressionMethod(
  zip: Uint8Array,
  entryName: string,
  method: number
): Uint8Array {
  const patched = new Uint8Array(zip);

  for (let i = 0; i < patched.length - 46; i++) {
    if (
      patched[i] === 0x50 &&
      patched[i + 1] === 0x4b &&
      patched[i + 2] === 0x01 &&
      patched[i + 3] === 0x02
    ) {
      const nameLen = patched[i + 28]! | (patched[i + 29]! << 8);
      const nameStart = i + 46;
      const name = new TextDecoder().decode(
        patched.subarray(nameStart, nameStart + nameLen)
      );

      if (name === entryName) {
        patched[i + 10] = method & 0xff;
        patched[i + 11] = (method >> 8) & 0xff;
        return patched;
      }
    }
  }

  throw new Error(`entry not found: ${entryName}`);
}

/** Previous implementation: inflate every archive member before selection. */
function extractConnectionsCsvEager(zipBytes: Uint8Array): string {
  const entries = unzipSync(zipBytes);
  const entryPath = findConnectionsCsvEntry(Object.keys(entries));
  if (!entryPath) {
    throw new Error("No Connections.csv found in zip");
  }
  return new TextDecoder("utf-8").decode(entries[entryPath]!);
}

describe("findConnectionsCsvEntry", () => {
  it("prefers root Connections.csv over nested copy", () => {
    expect(
      findConnectionsCsvEntry([
        "Profile.csv",
        "data/Connections.csv",
        "Connections.csv",
      ])
    ).toBe("Connections.csv");
  });

  it("matches case-insensitively", () => {
    expect(findConnectionsCsvEntry(["CONNECTIONS.CSV"])).toBe("CONNECTIONS.CSV");
  });

  it("allows one nested directory", () => {
    expect(findConnectionsCsvEntry(["export/Connections.csv"])).toBe(
      "export/Connections.csv"
    );
  });

  it("ignores deeply nested paths", () => {
    expect(
      findConnectionsCsvEntry(["a/b/c/Connections.csv", "Profile.csv"])
    ).toBeUndefined();
  });
});

describe("extractConnectionsCsvFromZip", () => {
  it("extracts Connections.csv from a LinkedIn-style zip", () => {
    const zip = makeZip({
      "Profile.csv": "First Name,Last Name\nTrung,Le",
      "Connections.csv": SAMPLE_CSV,
    });

    expect(extractConnectionsCsvFromZip(zip)).toBe(SAMPLE_CSV);
  });

  it("extracts from a nested Connections.csv one level deep", () => {
    const zip = makeZip({
      "export/Connections.csv": SAMPLE_CSV,
    });

    expect(extractConnectionsCsvFromZip(zip)).toBe(SAMPLE_CSV);
  });

  it("throws when Connections.csv is missing", () => {
    const zip = makeZip({ "Profile.csv": "x" });
    expect(() => extractConnectionsCsvFromZip(zip)).toThrow(/Connections\.csv/);
  });

  it("throws on invalid zip bytes", () => {
    expect(() => extractConnectionsCsvFromZip(new Uint8Array([1, 2, 3]))).toThrow(
      /Invalid zip archive/
    );
  });

  it("skips irrelevant members that would break eager full-archive extraction", () => {
    const zip = setEntryCompressionMethod(
      makeZip({
        "Profile.csv": "ignored profile payload",
        "Connections.csv": SAMPLE_CSV,
      }),
      "Profile.csv",
      99
    );

    expect(() => extractConnectionsCsvEager(zip)).toThrow();
    expect(extractConnectionsCsvFromZip(zip)).toBe(SAMPLE_CSV);
  });

  it("does not decompress oversized non-connections members (zip-bomb guard)", () => {
    const zip = makeZip({
      "Profile.csv": "x".repeat(8 * 1024 * 1024),
      "Connections.csv": SAMPLE_CSV,
    });

    expect(extractConnectionsCsvFromZip(zip)).toBe(SAMPLE_CSV);
  });

  it("rejects Connections.csv whose declared size exceeds the CSV cap", () => {
    const zip = makeZip({
      "Connections.csv": "a".repeat(5 * 1024 * 1024 + 1),
    });

    expect(() => extractConnectionsCsvFromZip(zip)).toThrow(/too large/i);
  });
});
