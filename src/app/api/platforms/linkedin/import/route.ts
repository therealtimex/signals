import { NextRequest, NextResponse } from "next/server";
import { parseLinkedInCsv, importLinkedInCsv } from "@/lib/platforms/linkedin/csv-import";
import { extractConnectionsCsvFromZip } from "@/lib/platforms/linkedin/zip-import";

const MAX_CSV_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ZIP_SIZE = 25 * 1024 * 1024; // 25MB

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
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const kind = getImportKind(file.name);
    if (!kind) {
      return NextResponse.json(
        { error: "File must be a .csv or .zip LinkedIn export" },
        { status: 400 }
      );
    }

    const text = await readConnectionsCsv(file, kind);
    const rows = parseLinkedInCsv(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found in CSV. Make sure it's a LinkedIn Connections export." },
        { status: 400 }
      );
    }

    const result = importLinkedInCsv(rows);

    return NextResponse.json({
      success: true,
      result,
      totalRows: rows.length,
      source: kind,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    const status = message.startsWith("File too large") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
