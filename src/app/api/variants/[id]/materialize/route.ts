import { NextResponse } from "next/server";
import { badRequestResponse, toErrorResponse } from "@/lib/api/errors";
import { materializeVariant } from "@/lib/writing/materialize";
import {
  proposalDecisionBodySchema,
  refreshedProposal,
} from "@/lib/writing/proposal-rest";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = proposalDecisionBodySchema.safeParse(await request.json());
    if (!body.success) return badRequestResponse("Invalid proposal decision");
    const { id } = await params;
    const result = await materializeVariant({
      variantId: id,
      approval: {
        by: "user",
        evidence: { kind: "ui", route: body.data.route },
        ...(body.data.note ? { note: body.data.note } : {}),
      },
    });
    return NextResponse.json({ ...result, proposal: refreshedProposal(id).proposal });
  } catch (error) {
    if (error instanceof SyntaxError) return badRequestResponse("Invalid JSON body");
    return toErrorResponse(error);
  }
}
