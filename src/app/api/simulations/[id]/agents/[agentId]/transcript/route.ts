import { NextRequest, NextResponse } from "next/server";
import {
  getSimulationAgentTranscript,
  getSimulationRun,
} from "@/lib/db/queries/simulations";
import { notFoundResponse } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> },
) {
  const { id: runId, agentId } = await params;

  if (!getSimulationRun(runId)) {
    return notFoundResponse("Simulation run not found", "RUN_NOT_FOUND");
  }

  const transcript = getSimulationAgentTranscript(runId, agentId);
  if (transcript === undefined) {
    return notFoundResponse("Agent not found in simulation run", "AGENT_NOT_FOUND");
  }
  if (transcript === null) {
    return notFoundResponse("Transcript not found", "TRANSCRIPT_NOT_FOUND");
  }

  return NextResponse.json({
    agentId,
    content: transcript.content,
    byteSize: transcript.byteSize,
    tokenCount: transcript.tokenCount,
  });
}
