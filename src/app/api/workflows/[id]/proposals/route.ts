import { NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import {
  listWorkflowRunProposals,
  summarizeWorkflowRunProposals,
} from "@/lib/writing/workflow-run-proposals";
import { observeObjectiveSourcesForRun } from "@/lib/writing/objective-sources";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getWorkflowRun(id)) {
    return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  }
  if (summarizeWorkflowRunProposals(id) === null) {
    return NextResponse.json({
      launches: [],
      objective: null,
      objectiveSource: null,
      proposals: [],
      summary: null,
    });
  }
  // Re-read the objective's workspace sources before projecting (#549, ADR-549-24): a changed
  // source revokes unmaterialized approvals once, and the page shows the stale state.
  const observation = await observeObjectiveSourcesForRun(id);
  return NextResponse.json(listWorkflowRunProposals(id, {
    ...(observation ? { objectiveSource: observation.objectiveSource } : {}),
  }));
}
