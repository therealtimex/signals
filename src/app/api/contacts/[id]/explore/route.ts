import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse } from "@/lib/api/errors";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const explore = getContactExploreCard(id);
  if (!explore) {
    return notFoundResponse("Contact not found");
  }
  return NextResponse.json(explore);
}
