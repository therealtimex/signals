import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse } from "@/lib/api/errors";
import { getContactById } from "@/lib/db/queries/contacts";
import { listContactTimeline } from "@/lib/db/queries/contact-timeline";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getContactById(id)) {
    return notFoundResponse("Contact not found");
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "50", 10) || 50;

  const result = listContactTimeline(id, { page, pageSize });
  return NextResponse.json({
    items: result.data,
    total: result.total,
    page,
    pageSize,
  });
}
