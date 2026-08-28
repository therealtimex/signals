import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { getOrgRelationshipSummary } from "@/lib/db/queries/org-relationships";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return NextResponse.json(
    getOrgRelationshipSummary(id, {
      includeLocalOnly: new URL(req.url).searchParams.get("includeLocalOnly") === "true",
    }),
  );
}
