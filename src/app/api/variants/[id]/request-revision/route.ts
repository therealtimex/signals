import { NextResponse } from "next/server";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";
import { badRequestResponse, toErrorResponse } from "@/lib/api/errors";
import {
  proposalRevisionBodySchema,
  refreshedProposal,
} from "@/lib/writing/proposal-rest";
import { requestWritingProposalRevision } from "@/lib/writing/variant-writing";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = proposalRevisionBodySchema.safeParse(await request.json());
    if (!body.success) return badRequestResponse("Invalid revision request");
    const { id } = await params;
    requestWritingProposalRevision(id, {
      evidence: { kind: "ui", route: body.data.route },
      note: body.data.note,
    });
    const refreshed = refreshedProposal(id);
    const refs = getRtxRefsFromRunConfig(refreshed.run?.config);
    const thread = refs.workspaceSlug && refs.threadSlug
      ? {
          workspaceSlug: refs.workspaceSlug,
          threadSlug: refs.threadSlug,
          threadPath: `/workspace/${refs.workspaceSlug}/t/${refs.threadSlug}`,
        }
      : null;
    return NextResponse.json({ proposal: refreshed.proposal, thread });
  } catch (error) {
    if (error instanceof SyntaxError) return badRequestResponse("Invalid JSON body");
    return toErrorResponse(error);
  }
}
