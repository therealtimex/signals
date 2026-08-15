import { NextRequest, NextResponse } from "next/server";
import { listLaunches, getLaunchWithDetails, upsertLaunch } from "@/lib/db/queries/launches";
import { createLaunchSchema, launchListQuerySchema } from "@/lib/api/gtm-schemas";
import { badRequestResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeLaunch } from "@/lib/serializers/gtm";

export async function GET(req: NextRequest) {
  try {
    const parsed = launchListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = listLaunches({
      search: parsed.search,
      status: parsed.status,
      page: parsed.page,
      pageSize: parsed.pageSize,
      includeLocalOnly: parsed.includeLocalOnly,
    });
    return NextResponse.json({
      data: result.data.map(serializeLaunch),
      total: result.total,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createLaunchSchema.parse(body);
    const launch = upsertLaunch({
      name: data.name,
      brief: data.brief,
      status: data.status,
      primaryPlatform: data.primaryPlatform,
      audienceSpec: data.audienceSpec,
      workflowTemplateId: data.workflowTemplateId,
      scope: data.scope,
      metadata: data.metadata,
      launchedAt: data.launchedAt,
      completedAt: data.completedAt,
    });
    const detailed = getLaunchWithDetails(launch.id);
    return NextResponse.json(serializeLaunch(detailed!), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequestResponse("Invalid JSON body");
    }
    return toErrorResponse(error);
  }
}
