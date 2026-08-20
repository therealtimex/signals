import { NextResponse } from "next/server";
import { setDefaultTarget, toPlatformTargetView } from "@/lib/db/queries/platform-targets";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const target = setDefaultTarget(id);
  return target
    ? NextResponse.json({ target: toPlatformTargetView(target) })
    : NextResponse.json({ error: "Target not found" }, { status: 404 });
}
