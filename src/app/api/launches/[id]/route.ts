import { NextRequest, NextResponse } from "next/server";
import { getLaunchById, getLaunchWithDetails, upsertLaunch } from "@/lib/db/queries/launches";
import { updateLaunchSchema } from "@/lib/api/gtm-schemas";
import { badRequestResponse, notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeLaunch } from "@/lib/serializers/gtm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const launch = getLaunchWithDetails(id);
    if (!launch) {
      return notFoundResponse("Launch not found");
    }
    return NextResponse.json(serializeLaunch(launch));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getLaunchById(id)) {
    return notFoundResponse("Launch not found");
  }

  try {
    const body = await req.json();
    const data = updateLaunchSchema.parse(body);
    upsertLaunch({
      id,
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
    const launch = getLaunchWithDetails(id);
    return NextResponse.json(serializeLaunch(launch!));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequestResponse("Invalid JSON body");
    }
    return toErrorResponse(error);
  }
}
