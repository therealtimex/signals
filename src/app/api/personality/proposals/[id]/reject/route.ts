import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, personalityErrorResponse } from "@/app/api/personality/http";
import { rejectPersonalityProposal } from "@/lib/personality/proposal";

const rejectSchema = z.object({ note: z.string().max(4_096).optional() }).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const input = rejectSchema.parse(await jsonBody(request));
    return NextResponse.json(await rejectPersonalityProposal({
      proposalId: (await params).id,
      evidence: { kind: "ui", route: new URL(request.url).pathname },
      ...input,
    }));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
