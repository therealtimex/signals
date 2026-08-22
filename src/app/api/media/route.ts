import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { extname } from "path";
import { join } from "path";
import { nanoid } from "nanoid";
import imageSize from "image-size";
import { createMediaAsset, listMediaAssets, MEDIA_DIR } from "@/lib/db/queries/media";
import { validateMediaFile } from "@/lib/media/constraints";
import { PUBLISH_PLATFORM_TARGETS } from "@/lib/publish/payload";
import { validateAttachmentFile } from "@/lib/media/attachment-constraints";
import { isImageType } from "@/lib/media/constraints";

// Allow up to 20MB uploads (covers all image types in Phase 6A)
// Next.js App Router handles formData natively — no bodyParser config needed.
// For very large files, a route segment config `maxDuration` can be set if needed.

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const platformTarget = formData.get("platformTarget") as string | null;
    const context = (formData.get("context") as string | null) ?? "compose";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (context !== "compose" && context !== "attachment") {
      return NextResponse.json({ error: "Invalid upload context" }, { status: 400 });
    }

    if (
      platformTarget &&
      !(PUBLISH_PLATFORM_TARGETS as readonly string[]).includes(platformTarget)
    ) {
      return NextResponse.json({ error: "Invalid platformTarget" }, { status: 400 });
    }

    let validationError: string | null = null;
    if (context === "attachment") {
      validationError = validateAttachmentFile({
        name: file.name,
        type: file.type,
        size: file.size,
      });
    } else {
      const platform =
        (platformTarget as (typeof PUBLISH_PLATFORM_TARGETS)[number]) || "x";
      validationError = validateMediaFile(
        { name: file.name, type: file.type, size: file.size },
        platform,
      );
    }
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Generate storage path
    const ext = extname(file.name).toLowerCase() || ".bin";
    const storagePath = `${nanoid()}${ext}`;

    // Ensure media directory exists
    mkdirSync(MEDIA_DIR, { recursive: true });

    // Write file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(join(MEDIA_DIR, storagePath), buffer);

    // Extract dimensions for images
    let width: number | undefined;
    let height: number | undefined;
    if (isImageType(file.type)) {
      try {
        const dimensions = imageSize(buffer);
        width = dimensions.width;
        height = dimensions.height;
      } catch {
        // Non-fatal — dimensions will be null
      }
    }

    const asset = createMediaAsset({
      filename: file.name,
      storagePath,
      mimeType: file.type,
      fileSize: file.size,
      width: width ?? null,
      height: height ?? null,
      origin: "upload",
      scope: context === "attachment" ? "local_only" : "shared",
    });

    return NextResponse.json(asset, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contentItemId = searchParams.get("contentItemId") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "50", 10) || 50;

  const result = listMediaAssets({ contentItemId, page, pageSize });
  return NextResponse.json({ assets: result.data, total: result.total });
}
