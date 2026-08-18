import { NextRequest, NextResponse } from "next/server";
import { previewXArchiveImport } from "@/lib/platforms/x/import-preview";

/**
 * POST /api/platforms/x/import/preview
 * Inspect an uploaded X data archive zip without writing to the database.
 * Used by the import modal's inspection step before the user confirms
 * Run import. No connected X account is required.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const preview = await previewXArchiveImport(file);
    return NextResponse.json({ success: true, preview });
  } catch (err) {
    // All preview failures are client-file problems — wrong kind, size,
    // invalid zip, or no importable data files.
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
