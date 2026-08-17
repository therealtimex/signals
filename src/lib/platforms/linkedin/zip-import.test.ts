import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
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
});
