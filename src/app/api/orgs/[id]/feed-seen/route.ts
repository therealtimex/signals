import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";
import { getOrgById } from "@/lib/db/queries/orgs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const feedSeenAt = Math.floor(Date.now() / 1000);
  db.update(orgs).set({ feedSeenAt }).where(eq(orgs.id, id)).run();
  return NextResponse.json({ feedSeenAt });
}
