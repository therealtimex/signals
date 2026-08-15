import { NextRequest, NextResponse } from "next/server";
import { getVariantById, upsertVariant } from "@/lib/db/queries/variants";
import { updateVariantSchema } from "@/lib/api/gtm-schemas";
import { badRequestResponse, notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeVariant } from "@/lib/serializers/gtm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const variant = getVariantById(id);
  if (!variant) {
    return notFoundResponse("Variant not found");
  }
  return NextResponse.json(serializeVariant(variant));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = getVariantById(id);
  if (!existing) {
    return notFoundResponse("Variant not found");
  }

  try {
    const body = await req.json();
    const data = updateVariantSchema.parse(body);
    const variant = upsertVariant({
      id,
      launchId: existing.launchId,
      label: data.label,
      variantType: data.variantType,
      body: data.body,
      status: data.status,
    });
    return NextResponse.json(serializeVariant(variant));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequestResponse("Invalid JSON body");
    }
    return toErrorResponse(error);
  }
}
