import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrgById } from "@/lib/db/queries/orgs";
import { setOrgEmailPattern } from "@/lib/contacts/email-patterns/intelligence";
import { isValidEmailPattern } from "@/lib/contacts/email-patterns/patterns";

const schema = z.object({ pattern: z.string().refine(isValidEmailPattern, "Invalid email pattern") });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const { pattern } = schema.parse(await req.json());
  return NextResponse.json(setOrgEmailPattern(id, { pattern }));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(setOrgEmailPattern(id, { clear: true }));
}
