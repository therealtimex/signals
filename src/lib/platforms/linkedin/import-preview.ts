import { parseLinkedInCsv } from "@/lib/platforms/linkedin/csv-import";
import {
  getImportKind,
  readConnectionsCsv,
  type ImportKind,
} from "@/lib/platforms/linkedin/import-file";

export interface LinkedInImportPreview {
  source: ImportKind;
  fileName: string;
  fileSize: number;
  totalRows: number;
}

/**
 * Inspect a LinkedIn export upload without writing to the database:
 * validate the file kind and size, extract Connections.csv for zips,
 * and count parseable rows. Throws with a user-facing message for
 * invalid files (wrong extension, oversized, missing Connections.csv,
 * no parseable rows).
 */
export async function previewLinkedInImport(file: File): Promise<LinkedInImportPreview> {
  const kind = getImportKind(file.name);
  if (!kind) {
    throw new Error("File must be a .csv or .zip LinkedIn export");
  }

  const text = await readConnectionsCsv(file, kind);
  const rows = parseLinkedInCsv(text);

  if (rows.length === 0) {
    throw new Error(
      "No valid rows found in CSV. Make sure it's a LinkedIn Connections export."
    );
  }

  return {
    source: kind,
    fileName: file.name,
    fileSize: file.size,
    totalRows: rows.length,
  };
}
