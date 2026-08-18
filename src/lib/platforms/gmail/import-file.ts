import { extractTakeoutVcardsFromZip } from "@/lib/platforms/gmail/zip-import";
import { parseTakeoutContactsText } from "@/lib/platforms/gmail/takeout-parse";

export const MAX_VCF_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_ZIP_SIZE = 50 * 1024 * 1024; // 50MB

export type TakeoutImportKind = "vcf" | "zip";

export function getTakeoutImportKind(fileName: string): TakeoutImportKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vcf")) return "vcf";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

/**
 * Read Google Takeout contacts from .vcf or .zip upload.
 * Throws with a user-facing message for invalid or oversized files.
 */
export async function readTakeoutContactsFile(
  file: File,
  kind: TakeoutImportKind
): Promise<{ text: string; source: TakeoutImportKind }> {
  const maxSize = kind === "zip" ? MAX_ZIP_SIZE : MAX_VCF_SIZE;
  if (file.size > maxSize) {
    const limitMb = maxSize / (1024 * 1024);
    throw new Error(`File too large (max ${limitMb}MB)`);
  }

  if (kind === "vcf") {
    return { text: await file.text(), source: "vcf" };
  }

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  const text = extractTakeoutVcardsFromZip(zipBytes);
  return { text, source: "zip" };
}

/** Parse uploaded Takeout file into contact rows. */
export async function parseTakeoutContactsFile(file: File) {
  const kind = getTakeoutImportKind(file.name);
  if (!kind) {
    throw new Error("File must be a Google Takeout .zip or .vcf contacts export");
  }

  const { text, source } = await readTakeoutContactsFile(file, kind);
  const rows = parseTakeoutContactsText(text, file.name);

  if (rows.length === 0) {
    throw new Error("No contacts found in export. Check that Contacts were included in Takeout.");
  }

  return { rows, source, kind };
}
