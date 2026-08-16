import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOrg, listOrgsWithContactCounts } from "@/lib/db/queries/orgs";
import { normalizeOrgWebsiteUrl } from "@/lib/org-website";

const createOrgSchema = z.object({
  name: z.string().min(1, "Name is required"),
  orgType: z.enum(["company", "fund", "team", "community", "other"]).optional(),
  domain: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});

function parseWebsite(website: string | null | undefined): string | null {
  try {
    return normalizeOrgWebsiteUrl(website);
  } catch {
    throw new Error("Invalid website URL");
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10) || 25;
  const includeLocalOnly = searchParams.get("includeLocalOnly") === "true";

  const result = listOrgsWithContactCounts({ search, page, pageSize, includeLocalOnly });
  return NextResponse.json({ data: result.data, total: result.total });
}

export async function POST(req: NextRequest) {
  try {
    const body = createOrgSchema.parse(await req.json());
    const org = createOrg({
      name: body.name,
      orgType: body.orgType,
      domain: body.domain,
      website: parseWebsite(body.website),
      description: body.description,
      location: body.location,
      source: "ui",
    });
    return NextResponse.json(org, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (
      error instanceof Error &&
      (error.message === "Organization name is required" ||
        error.message === "Invalid website URL")
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
