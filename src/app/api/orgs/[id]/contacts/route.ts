import { NextRequest, NextResponse } from "next/server";
import { getOrgById, listOrgLinkedContacts } from "@/lib/db/queries/orgs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const org = getOrgById(id);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const includeLocalOnly =
    new URL(req.url).searchParams.get("includeLocalOnly") === "true";
  const contacts = listOrgLinkedContacts(id, { includeLocalOnly });
  return NextResponse.json({ data: contacts, total: contacts.length });
}
