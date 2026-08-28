import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOrg, listOrgsWithContactCounts } from "@/lib/db/queries/orgs";
import { validateWorkflowRunAndTemplateIds } from "@/lib/db/creation-provenance-input";
import type { CreationTag } from "@/lib/db/creation-sources";
import { toErrorResponse } from "@/lib/api/errors";
import { accountStageSchema, companySizeSchema } from "@/lib/orgs/schemas";

const createOrgSchema = z.object({
  name: z.string().min(1, "Name is required"),
  orgType: z.enum(["company", "fund", "team", "community", "other"]).optional(),
  domain: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  companySize: companySizeSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  ownerContactId: z.string().min(1).optional().nullable(),
  accountStage: accountStageSchema.optional().nullable(),
  createdVia: z.literal("manual").optional(),
  workflowRunId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10) || 25;
  const includeLocalOnly = searchParams.get("includeLocalOnly") === "true";
  const stage = searchParams.get("stage") ?? undefined;
  const owner = searchParams.get("owner") ?? undefined;
  const followedParam = searchParams.get("followed");
  const followed = followedParam === "true" ? true : followedParam === "false" ? false : undefined;
  const tag = searchParams.get("tag") ?? undefined;

  const result = listOrgsWithContactCounts({
    search,
    page,
    pageSize,
    includeLocalOnly,
    stage: stage as NonNullable<Parameters<typeof listOrgsWithContactCounts>[0]>["stage"],
    owner,
    followed,
    tag,
  });
  return NextResponse.json({ data: result.data, total: result.total });
}

export async function POST(req: NextRequest) {
  try {
    const body = createOrgSchema.parse(await req.json());

    let resolvedIds: { workflowRunId: string | null; templateId: string | null };
    try {
      resolvedIds = validateWorkflowRunAndTemplateIds({
        workflowRunId: body.workflowRunId,
        templateId: body.templateId,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid workflow context" },
        { status: 400 },
      );
    }

    const creationTag: CreationTag =
      body.createdVia === "manual" ? "manual:create_org" : "api:create_org";

    const org = createOrg({
      name: body.name,
      orgType: body.orgType,
      domain: body.domain,
      website: body.website,
      description: body.description,
      location: body.location,
      industry: body.industry,
      companySize: body.companySize,
      tags: body.tags,
      ownerContactId: body.ownerContactId,
      accountStage: body.accountStage,
      source: "ui",
      provenance: {
        tag: creationTag,
        workflowRunId: resolvedIds.workflowRunId,
        templateId: resolvedIds.templateId,
      },
    });
    return NextResponse.json(org, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return toErrorResponse(error);
    if (
      error instanceof Error &&
      (error.message === "Organization name is required" ||
        error.message === "Invalid website URL")
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return toErrorResponse(error);
  }
}
