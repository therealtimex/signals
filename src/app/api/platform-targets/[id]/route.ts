import { NextResponse } from "next/server";
import { forgetPlatformTarget } from "@/lib/db/queries/platform-targets";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return forgetPlatformTarget(id)
    ? NextResponse.json({ forgotten: true })
    : NextResponse.json({ error: "Target not found" }, { status: 404 });
}
