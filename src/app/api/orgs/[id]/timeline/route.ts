import { NextRequest, NextResponse } from "next/server";
import { getOrgById } from "@/lib/db/queries/orgs";
import { listOrgTimeline } from "@/lib/db/queries/org-activities";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getOrgById(id)) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const search = new URL(req.url).searchParams;
  return NextResponse.json(listOrgTimeline(id, {
    page: Number(search.get("page") ?? 1),
    pageSize: Number(search.get("pageSize") ?? 25),
    category: (search.get("category") as "signal" | "workspace" | "all") ?? undefined,
    types: search.getAll("type"),
    since: search.get("since") ? Number(search.get("since")) : undefined,
    includeLocalOnly: search.get("includeLocalOnly") === "true",
  }));
}
