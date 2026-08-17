import { extractConnectionsCsvFromZip } from "@/lib/platforms/linkedin/zip-import";

export const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_ZIP_SIZE = 25 * 1024 * 1024; // 25MB

export type ImportKind = "csv" | "zip";

export function getImportKind(fileName: string): ImportKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

/**
 * Read the Connections CSV text from an uploaded LinkedIn export file —
 * directly for .csv uploads, or extracted from a Basic Data Export zip.
 * Throws with a user-facing message for oversized or invalid files.
 */
export async function readConnectionsCsv(file: File, kind: ImportKind): Promise<string> {
  const maxSize = kind === "zip" ? MAX_ZIP_SIZE : MAX_CSV_SIZE;
  if (file.size > maxSize) {
    const limitMb = maxSize / (1024 * 1024);
    throw new Error(`File too large (max ${limitMb}MB)`);
  }

  if (kind === "csv") {
    return file.text();
  }

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  return extractConnectionsCsvFromZip(zipBytes);
}
