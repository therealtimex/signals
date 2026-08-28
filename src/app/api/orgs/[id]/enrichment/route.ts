import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { getOrgEnrichmentState } from "@/lib/orgs/enrichment";
import { notFoundResponse } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return notFoundResponse("Company not found");
  return NextResponse.json(getOrgEnrichmentState(id));
}
