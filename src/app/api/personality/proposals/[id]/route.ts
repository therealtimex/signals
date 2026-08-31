import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { getPersonalityProposal } from "@/lib/personality/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(getPersonalityProposal((await params).id));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
