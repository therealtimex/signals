import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { retryPersonalityProposal } from "@/lib/personality/apply";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await retryPersonalityProposal((await params).id));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
