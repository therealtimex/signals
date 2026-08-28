import { NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import {
  getOrgEmailIntelligence,
  inferOrgEmailPatterns,
} from "@/lib/contacts/email-patterns/intelligence";
import { checkOrgMailDomains } from "@/lib/contacts/email-verification/mail-domains";
import { z } from "zod";

const schema = z.object({ checkMail: z.boolean().optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const { checkMail } = schema.parse(await req.json().catch(() => ({})));
  const result = inferOrgEmailPatterns(id);
  if (checkMail && result.canInfer) await checkOrgMailDomains(id);
  return NextResponse.json(result.canInfer ? getOrgEmailIntelligence(id) : result);
}
