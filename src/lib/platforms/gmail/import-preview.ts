import { parseTakeoutContactsFile } from "@/lib/platforms/gmail/import-file";
import type { TakeoutImportKind } from "@/lib/platforms/gmail/import-file";

export interface GmailTakeoutImportPreview {
  source: TakeoutImportKind;
  fileName: string;
  fileSize: number;
  totalRows: number;
}

/** Inspect a Google Takeout upload without writing to the database. */
export async function previewGmailTakeoutImport(file: File): Promise<GmailTakeoutImportPreview> {
  const { rows, source } = await parseTakeoutContactsFile(file);

  return {
    source,
    fileName: file.name,
    fileSize: file.size,
    totalRows: rows.length,
  };
}
