import { NextRequest, NextResponse } from "next/server";
import { getTakeoutImportKind, parseTakeoutContactsFile } from "@/lib/platforms/gmail/import-file";
import { importTakeoutContacts } from "@/lib/platforms/gmail/takeout-import";
import { recordImportRun } from "@/lib/workflows/record-import-run";
import type { TakeoutImportKind } from "@/lib/platforms/gmail/import-file";

const GMAIL_TAKEOUT_IMPORT_SUBTYPE = "gmail_takeout_contacts";

export async function POST(req: NextRequest) {
  let file: File | null = null;
  let source: TakeoutImportKind | null = null;
  const startedAt = Math.floor(Date.now() / 1000);

  try {
    const formData = await req.formData();
    file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const parsed = await parseTakeoutContactsFile(file);
    source = parsed.source;
    const result = importTakeoutContacts(parsed.rows);

    const run = recordImportRun({
      platform: "gmail",
      importSubType: GMAIL_TAKEOUT_IMPORT_SUBTYPE,
      source: parsed.source,
      fileName: file.name,
      startedAt,
      totalRows: parsed.rows.length,
      result,
    });

    return NextResponse.json({
      success: true,
      result,
      totalRows: parsed.rows.length,
      source: parsed.source,
      workflowRunId: run.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";

    if (file) {
      const kind = source ?? getTakeoutImportKind(file.name);
      if (kind) {
        recordImportRun({
          platform: "gmail",
          importSubType: GMAIL_TAKEOUT_IMPORT_SUBTYPE,
          source: kind,
          fileName: file.name,
          startedAt,
          error: message,
        });
      }
    }

    const status =
      message.startsWith("File too large") ||
      message.includes("too large") ||
      message.includes("No contacts found")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
