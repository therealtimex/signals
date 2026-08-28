import { NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { getOrgEmailIntelligence } from "@/lib/contacts/email-patterns/intelligence";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return NextResponse.json(getOrgEmailIntelligence(id));
}
