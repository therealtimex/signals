import { NextRequest, NextResponse } from "next/server";
import { getSimulationRun } from "@/lib/db/queries/simulations";
import { simulationDetailQuerySchema } from "@/lib/api/gtm-schemas";
import { notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeSimulationRun } from "@/lib/serializers/gtm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const query = simulationDetailQuerySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const includeAgents = Boolean(query.includeAgents || query.includeTranscripts);
    const run = getSimulationRun(id, {
      includeAgents,
      includeTranscripts: query.includeTranscripts,
      includeCalibration: query.includeCalibration,
    });
    if (!run) {
      return notFoundResponse("Simulation run not found");
    }
    return NextResponse.json(
      serializeSimulationRun(run, {
        includeAgents,
        includeTranscripts: query.includeTranscripts,
        includeCalibrations: query.includeCalibration,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
