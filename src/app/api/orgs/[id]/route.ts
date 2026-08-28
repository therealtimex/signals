import { NextRequest, NextResponse } from "next/server";
import { getOrgDTO, updateOrg } from "@/lib/db/queries/orgs";
import { getImmutableBirthFieldsError } from "@/lib/db/creation-provenance-input";
import { orgPatchSchema } from "@/lib/orgs/schemas";
import { notFoundResponse, toErrorResponse } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const org = getOrgDTO(id);
  if (!org) {
    return notFoundResponse("Company not found");
  }
  return NextResponse.json(org);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const raw = await req.json();
    const immutableError = getImmutableBirthFieldsError(raw);
    if (immutableError) {
      return NextResponse.json(
        { error: immutableError, code: "IMMUTABLE_PROVENANCE" },
        { status: 400 },
      );
    }

    const { updatedVia, ...patch } = orgPatchSchema.parse(raw);
    const updated = updateOrg(id, patch, {
      source: updatedVia === "manual" ? "manual" : "api",
      tag: updatedVia === "manual" ? "manual:update_org" : "api:update_org",
    });
    if (!updated) return notFoundResponse("Company not found");
    return NextResponse.json(getOrgDTO(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
