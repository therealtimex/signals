import { NextRequest, NextResponse } from "next/server";
import { getLaunchById } from "@/lib/db/queries/launches";
import { upsertVariant } from "@/lib/db/queries/variants";
import { createVariantSchema } from "@/lib/api/gtm-schemas";
import { badRequestResponse, notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeVariant } from "@/lib/serializers/gtm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: launchId } = await params;
    if (!getLaunchById(launchId)) {
      return notFoundResponse("Launch not found");
    }

    const body = await req.json();
    const data = createVariantSchema.parse(body);
    const variant = upsertVariant({
      launchId,
      label: data.label,
      variantType: data.variantType,
      body: data.body,
      status: data.status,
    });
    return NextResponse.json(serializeVariant(variant), { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequestResponse("Invalid JSON body");
    }
    return toErrorResponse(error);
  }
}
