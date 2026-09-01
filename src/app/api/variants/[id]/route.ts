import { NextRequest, NextResponse } from "next/server";
import { getVariantById, isWritingVariant, updateWritingVariantLabel } from "@/lib/db/queries/variants";
import { upsertVariantUseCase } from "@/lib/writing/variant-use-cases";
import { updateVariantSchema } from "@/lib/api/gtm-schemas";
import { badRequestResponse, notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { serializeVariant } from "@/lib/serializers/gtm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const variant = getVariantById(id);
    if (!variant) {
      return notFoundResponse("Variant not found");
    }
    return NextResponse.json(serializeVariant(variant));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = getVariantById(id);
    if (!existing) {
      return notFoundResponse("Variant not found");
    }

    const body = await req.json();
    const data = updateVariantSchema.parse(body);
    if (isWritingVariant(existing)) {
      if (data.body !== undefined || data.status !== undefined || data.variantType !== undefined) {
        return NextResponse.json(
          { error: "Writing variant body and lifecycle are tool-owned", code: "writing_variant_locked" },
          { status: 409 },
        );
      }
      const variant = updateWritingVariantLabel(id, data.label ?? existing.label);
      return NextResponse.json(serializeVariant(variant));
    }
    const variant = await upsertVariantUseCase({
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
