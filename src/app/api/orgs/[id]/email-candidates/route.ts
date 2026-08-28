import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { listOrgEmailCandidates } from "@/lib/contacts/email-verification/candidates";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const status = new URL(req.url).searchParams.get("status");
  const includePredicted = new URL(req.url).searchParams.get("includePredicted") === "true";
  const data = listOrgEmailCandidates(id, {
    status: status as "predicted" | "uncertain" | "verified" | "invalid" | undefined,
    includePredicted,
  });
  return NextResponse.json({ data, total: data.length });
}
