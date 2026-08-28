import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrgById } from "@/lib/db/queries/orgs";
import { generateOrgEmailCandidates } from "@/lib/contacts/email-patterns/intelligence";

const schema = z.object({ contactIds: z.array(z.string().min(1)).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const body = schema.parse(await req.json().catch(() => ({})));
  return NextResponse.json(generateOrgEmailCandidates(id, body));
}
