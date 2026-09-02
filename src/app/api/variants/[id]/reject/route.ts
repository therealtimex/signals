import { NextResponse } from "next/server";
import { badRequestResponse, toErrorResponse } from "@/lib/api/errors";
import {
  proposalDecisionBodySchema,
  refreshedProposal,
} from "@/lib/writing/proposal-rest";
import { rejectWritingProposal } from "@/lib/writing/variant-writing";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = proposalDecisionBodySchema.safeParse(await request.json());
    if (!body.success) return badRequestResponse("Invalid proposal decision");
    const { id } = await params;
    rejectWritingProposal(id, {
      evidence: { kind: "ui", route: body.data.route },
      ...(body.data.note ? { note: body.data.note } : {}),
    });
    return NextResponse.json({ proposal: refreshedProposal(id).proposal });
  } catch (error) {
    if (error instanceof SyntaxError) return badRequestResponse("Invalid JSON body");
    return toErrorResponse(error);
  }
}
