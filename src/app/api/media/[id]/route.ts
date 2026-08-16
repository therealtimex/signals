import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getMediaAsset, deleteMediaAsset, MEDIA_DIR } from "@/lib/db/queries/media";
import { contentDispositionForMime } from "@/lib/media/serving-policy";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const asset = getMediaAsset(id);
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = join(MEDIA_DIR, asset.storagePath);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(buffer.length),
      "Content-Disposition": contentDispositionForMime(asset.mimeType, asset.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deleted = deleteMediaAsset(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
