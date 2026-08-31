import { NextResponse } from "next/server";
import { personalityErrorResponse } from "@/app/api/personality/http";
import { approvePersonalityProjection } from "@/lib/personality/use-cases";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(await approvePersonalityProjection({
      proposalId: (await params).id,
      evidence: { kind: "ui", route: new URL(request.url).pathname },
    }));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
