import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";
import { getOrgById } from "@/lib/db/queries/orgs";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

const schema = z.object({ follow: z.boolean() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const { follow } = schema.parse(await req.json());
  const now = Math.floor(Date.now() / 1000);
  const followedAt = follow ? now : null;
  db.update(orgs).set({ followedAt, updatedAt: now }).where(eq(orgs.id, id)).run();
  logOrgActivity({
    orgId: id,
    activityType: follow ? "followed" : "unfollowed",
    title: follow ? "Company followed" : "Company unfollowed",
    source: "manual:follow_org",
    dedupeKey: `${follow ? "followed" : "unfollowed"}:${id}:${now}`,
  });
  return NextResponse.json({ followedAt });
}
