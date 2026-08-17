import { NextRequest, NextResponse } from "next/server";
import { parseLinkedInCsv, importLinkedInCsv } from "@/lib/platforms/linkedin/csv-import";
import { extractConnectionsCsvFromZip } from "@/lib/platforms/linkedin/zip-import";
import { recordImportRun } from "@/lib/workflows/record-import-run";

const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ZIP_SIZE = 25 * 1024 * 1024; // 25MB

const LINKEDIN_IMPORT_SUBTYPE = "linkedin_connections";

type ImportKind = "csv" | "zip";

function getImportKind(fileName: string): ImportKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

async function readConnectionsCsv(file: File, kind: ImportKind): Promise<string> {
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

export async function POST(req: NextRequest) {
  let file: File | null = null;
  let kind: ImportKind | null = null;
  const startedAt = Math.floor(Date.now() / 1000);

  try {
    const formData = await req.formData();
    file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    kind = getImportKind(file.name);
    if (!kind) {
      return NextResponse.json(
        { error: "File must be a .csv or .zip LinkedIn export" },
        { status: 400 }
      );
    }

    const text = await readConnectionsCsv(file, kind);
    const rows = parseLinkedInCsv(text);

    if (rows.length === 0) {
      throw new Error(
        "No valid rows found in CSV. Make sure it's a LinkedIn Connections export."
      );
    }

    const result = importLinkedInCsv(rows);

    const run = recordImportRun({
      platform: "linkedin",
      importSubType: LINKEDIN_IMPORT_SUBTYPE,
      source: kind,
      fileName: file.name,
      startedAt,
      totalRows: rows.length,
      result,
    });

    return NextResponse.json({
      success: true,
      result,
      totalRows: rows.length,
      source: kind,
      workflowRunId: run.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";

    // Record failed attempts once we know a plausible export file was uploaded.
    if (file && kind) {
      recordImportRun({
        platform: "linkedin",
        importSubType: LINKEDIN_IMPORT_SUBTYPE,
        source: kind,
        fileName: file.name,
        startedAt,
        error: message,
      });
    }

    const status =
      message.startsWith("File too large") ||
      message.includes("too large") ||
      message.startsWith("No valid rows")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
