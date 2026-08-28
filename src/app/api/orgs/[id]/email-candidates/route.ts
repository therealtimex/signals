import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contactEmailCandidates } from "@/lib/db/schema";
import { getOrgById } from "@/lib/db/queries/orgs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const status = new URL(req.url).searchParams.get("status");
  const data = db.select().from(contactEmailCandidates).where(
    and(
      eq(contactEmailCandidates.orgId, id),
      status ? eq(contactEmailCandidates.status, status as "predicted") : undefined,
    ),
  ).all();
  return NextResponse.json({ data, total: data.length });
}
