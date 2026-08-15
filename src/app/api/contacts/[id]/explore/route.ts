import { NextRequest, NextResponse } from "next/server";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const explore = getContactExploreCard(id);
  if (!explore) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json(explore);
}
