import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { previewLinkedInImport } from "@/lib/platforms/linkedin/import-preview";

const CONNECTIONS_CSV = [
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Ada,Lovelace,https://www.linkedin.com/in/ada,ada@example.com,Analytical Engines,Countess,01 Jan 2020",
  "Grace,Hopper,https://www.linkedin.com/in/grace,,Navy,RDML,02 Feb 2021",
].join("\n");

function csvFile(name = "Connections.csv", content = CONNECTIONS_CSV): File {
  return new File([content], name, { type: "text/csv" });
}

function zipFile(entries: Record<string, string>, name = "Basic_LinkedInDataExport.zip"): File {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]))
  );
  return new File([Uint8Array.from(zipped)], name, { type: "application/zip" });
}

describe("previewLinkedInImport", () => {
  it("previews a valid Connections CSV without writing anything", async () => {
    const file = csvFile();
    const preview = await previewLinkedInImport(file);

    expect(preview).toEqual({
      source: "csv",
      fileName: "Connections.csv",
      fileSize: file.size,
      totalRows: 2,
    });
  });

  it("previews a Basic Data Export zip containing Connections.csv", async () => {
    const file = zipFile({ "Connections.csv": CONNECTIONS_CSV });
    const preview = await previewLinkedInImport(file);

    expect(preview.source).toBe("zip");
    expect(preview.totalRows).toBe(2);
    expect(preview.fileName).toBe("Basic_LinkedInDataExport.zip");
  });

  it("rejects a zip without Connections.csv", async () => {
    const file = zipFile({ "Profile.csv": "First Name\nAda" });

    await expect(previewLinkedInImport(file)).rejects.toThrow(/No Connections\.csv found/);
  });

  it("rejects unsupported file extensions", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    await expect(previewLinkedInImport(file)).rejects.toThrow(/must be a \.csv or \.zip/);
  });

  it("rejects a CSV with no parseable rows", async () => {
    const file = csvFile("Connections.csv", "First Name,Last Name\n");

    await expect(previewLinkedInImport(file)).rejects.toThrow(/No valid rows/);
  });
});
