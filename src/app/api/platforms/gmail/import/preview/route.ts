import { NextRequest, NextResponse } from "next/server";
import { previewGmailTakeoutImport } from "@/lib/platforms/gmail/import-preview";

/**
 * POST /api/platforms/gmail/import/preview
 * Inspect a Google Takeout contacts export without writing to the database.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const preview = await previewGmailTakeoutImport(file);
    return NextResponse.json({ success: true, preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
