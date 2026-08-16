import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMediaAttachment } from "@/lib/db/queries/media-attachments";
import { ATTACHMENT_PARENTS, ATTACHMENT_ROLES } from "@/lib/db/media-attachment-types";

const attachSchema = z.object({
  mediaAssetId: z.string().min(1),
  parentType: z.enum(ATTACHMENT_PARENTS),
  parentId: z.string().min(1),
  role: z.enum(ATTACHMENT_ROLES).optional(),
  sortOrder: z.number().int().optional(),
  caption: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = attachSchema.parse(await req.json());
    const attachment = createMediaAttachment({
      mediaAssetId: body.mediaAssetId,
      parentType: body.parentType,
      parentId: body.parentId,
      role: body.role,
      sortOrder: body.sortOrder,
      caption: body.caption,
      source: "api:attach_media",
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
