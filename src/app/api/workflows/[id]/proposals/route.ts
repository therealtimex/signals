import { NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import {
  listWorkflowRunProposals,
  summarizeWorkflowRunProposals,
} from "@/lib/writing/workflow-run-proposals";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getWorkflowRun(id)) {
    return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  }
  if (summarizeWorkflowRunProposals(id) === null) {
    return NextResponse.json({ launches: [], proposals: [], summary: null });
  }
  return NextResponse.json(listWorkflowRunProposals(id));
}
