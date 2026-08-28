import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrgById } from "@/lib/db/queries/orgs";
import { logOrgActivity } from "@/lib/db/queries/org-activities";

const schema = z.object({
  activityType: z.literal("note"),
  title: z.string().trim().max(500).optional(),
  summary: z.string().trim().min(1).max(20_000),
  occurredAt: z.number().int().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const body = schema.parse(await req.json());
  const result = logOrgActivity({
    orgId: id,
    activityType: "note",
    title: body.title || "Note",
    summary: body.summary,
    occurredAt: body.occurredAt,
    source: "manual:add_org_note",
    dedupeKey: `note:${id}:${Date.now()}`,
  });
  return NextResponse.json(result.activity, { status: 201 });
}
