import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ContentItemLinkedError, getContentItem, updateContentItem, deleteContentItem } from "@/lib/db/queries/content";
import { readContentWriting } from "@/lib/writing/content-writing";

const updateContentSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  contentType: z.enum(["post", "article", "thread", "reply", "image", "video", "email", "dm", "newsletter"]).optional(),
  status: z.enum(["draft", "review", "approved", "scheduled", "published", "imported"]).optional(),
  origin: z.enum(["authored", "received", "imported"]).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  platformTarget: z.string().optional(),
  contactId: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getContentItem(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json();
    const data = updateContentSchema.parse(body);
    const existing = getContentItem(id);
    if (existing && readContentWriting(existing) && (data.body !== undefined || data.status !== undefined)) {
      return NextResponse.json({ error: "Writing artifact body and lifecycle are tool-owned", code: "writing_content_locked" }, { status: 409 });
    }

    const updated = updateContentItem(id, data);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let deleted: boolean;
  try {
    deleted = deleteContentItem(id);
  } catch (error) {
    if (error instanceof ContentItemLinkedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
