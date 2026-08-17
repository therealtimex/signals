import { NextRequest, NextResponse } from "next/server";
import { previewLinkedInImport } from "@/lib/platforms/linkedin/import-preview";

/**
 * POST /api/platforms/linkedin/import/preview
 * Inspect an uploaded LinkedIn export (.csv or Basic Data Export .zip)
 * without writing to the database. Used by the import modal's inspection
 * step before the user confirms Run import.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const preview = await previewLinkedInImport(file);
    return NextResponse.json({ success: true, preview });
  } catch (err) {
    // All preview failures are client-file problems — invalid kind, size,
    // archive contents, or no parseable rows.
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
