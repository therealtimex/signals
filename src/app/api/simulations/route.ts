import { NextRequest, NextResponse } from "next/server";
import { listSimulationRuns } from "@/lib/db/queries/simulations";
import { simulationListQuerySchema } from "@/lib/api/gtm-schemas";
import { toErrorResponse } from "@/lib/api/errors";
import { serializeSimulationRun } from "@/lib/serializers/gtm";

export async function GET(req: NextRequest) {
  try {
    const parsed = simulationListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = listSimulationRuns({
      variantId: parsed.variantId,
      launchId: parsed.launchId,
      batchId: parsed.batchId,
      status: parsed.status,
      page: parsed.page,
      pageSize: parsed.pageSize,
    });
    return NextResponse.json({
      data: result.data.map((run) => serializeSimulationRun(run)),
      total: result.total,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
