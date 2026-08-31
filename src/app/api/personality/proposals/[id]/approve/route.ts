import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { approvePersonalityProposal } from "@/lib/personality/apply";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await approvePersonalityProposal({
      proposalId: (await params).id,
      evidence: { kind: "ui", route: new URL(request.url).pathname },
    }));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
