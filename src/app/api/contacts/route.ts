import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listContacts, createContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { PlatformAccountConflictError } from "@/lib/db/identity-claims";
import { resolveContactCompanyFields } from "@/lib/contact-org-api";
import {
  contactIdentityInputSchema,
  createContactIdentities,
} from "@/lib/contact-identities-api";
import { channelInputSchema, employmentInputSchema } from "@/lib/agent-tools/schemas";
import {
  getDeprecatedPlatformFieldsError,
  getImmutableBirthFieldsError,
} from "@/lib/api/contact-route-validation";
import { validateWorkflowRunAndTemplateIds } from "@/lib/db/creation-provenance-input";
import type { CreationTag, CreatedSource } from "@/lib/db/creation-sources";
import { CreatedSourceDetailFilterError } from "@/lib/db/creation-sources";
import { ChannelWriteError } from "@/lib/db/queries/contact-channel-writes";
import { EmploymentWriteError } from "@/lib/db/queries/contact-employment-writes";
import {
  enrichmentTierToScoreRange,
  parseContactListSort,
} from "@/lib/contacts/list-filters";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_STATUS_ENUM,
} from "@/lib/relationship-goals";

const createContactSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  orgId: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  title: z.string().optional(),
  profileUrl: z.string().optional(),
  avatarUrl: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  website: z.string().optional(),
  photoUrl: z.string().optional(),
  tags: z.string().optional(),
  funnelStage: z
    .enum(["prospect", "engaged", "qualified", "opportunity", "customer", "advocate"])
    .optional(),
  relationshipGoal: z.enum(RELATIONSHIP_GOAL_ENUM).optional(),
  relationshipGoalStatus: z.enum(RELATIONSHIP_GOAL_STATUS_ENUM).optional(),
  score: z.number().int().min(0).optional(),
  isSelf: z.boolean().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
  identity: contactIdentityInputSchema.optional(),
  identities: z.array(contactIdentityInputSchema).optional(),
  createdVia: z.literal("manual").optional(),
  workflowRunId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
}).refine(
  (data) => data.name || data.firstName || data.lastName,
  { message: "At least name, firstName, or lastName is required" }
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const funnelStage = searchParams.get("funnelStage") ?? undefined;
  const relationshipGoal = searchParams.get("relationshipGoal") ?? undefined;
  const relationshipGoalStatus = searchParams.get("relationshipGoalStatus") ?? undefined;
  const platform = searchParams.get("platform") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10) || 25;

  const includeArchived = searchParams.get("includeArchived") === "true";
  const createdSource = searchParams.get("createdSource") ?? undefined;
  const createdSourceDetail = searchParams.get("createdSourceDetail") ?? undefined;
  const createdWorkflowRunId = searchParams.get("createdWorkflowRunId") ?? undefined;
  const createdTemplateId = searchParams.get("createdTemplateId") ?? undefined;
  const minEnrichmentScore = searchParams.get("minEnrichmentScore");
  const maxEnrichmentScore = searchParams.get("maxEnrichmentScore");
  const enrichmentTier = searchParams.get("enrichmentTier") ?? undefined;
  const sortParam = searchParams.get("sort") ?? undefined;
  const orderParam = searchParams.get("order") ?? undefined;
  const hasRelationshipGoal = searchParams.get("hasRelationshipGoal") === "true";
  const { sort, order } = parseContactListSort(sortParam, orderParam);

  const tierRange =
    enrichmentTier && enrichmentTier !== "all"
      ? enrichmentTierToScoreRange(enrichmentTier)
      : null;
  if (enrichmentTier && enrichmentTier !== "all" && !tierRange) {
    return NextResponse.json({ error: `Invalid enrichment tier: ${enrichmentTier}` }, { status: 400 });
  }

  try {
    const result = listContacts({
      search,
      funnelStage,
      relationshipGoal,
      relationshipGoalStatus,
      platform,
      page,
      pageSize,
      includeArchived,
      sort,
      order,
      hasRelationshipGoal: hasRelationshipGoal || undefined,
      ...(createdSource ? { createdSource: createdSource as CreatedSource } : {}),
      createdSourceDetail,
      createdWorkflowRunId,
      createdTemplateId,
      ...(minEnrichmentScore !== null && minEnrichmentScore !== ""
        ? { minEnrichmentScore: parseInt(minEnrichmentScore, 10) }
        : {}),
      ...(maxEnrichmentScore !== null && maxEnrichmentScore !== ""
        ? { maxEnrichmentScore: parseInt(maxEnrichmentScore, 10) }
        : {}),
      ...(tierRange?.minEnrichmentScore !== undefined
        ? { minEnrichmentScore: tierRange.minEnrichmentScore }
        : {}),
      ...(tierRange?.maxEnrichmentScore !== undefined
        ? { maxEnrichmentScore: tierRange.maxEnrichmentScore }
        : {}),
    });
    return NextResponse.json({ data: result.data, total: result.total });
  } catch (error) {
    if (error instanceof CreatedSourceDetailFilterError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deprecatedError = getDeprecatedPlatformFieldsError(body);
    if (deprecatedError) {
      return NextResponse.json({ error: deprecatedError }, { status: 400 });
    }

    const { identity, identities, orgId, company, employments, createdVia, workflowRunId, templateId, ...data } =
      createContactSchema.parse(body);

    let resolvedIds: { workflowRunId: string | null; templateId: string | null };
    try {
      resolvedIds = validateWorkflowRunAndTemplateIds({ workflowRunId, templateId });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid workflow context" },
        { status: 400 },
      );
    }

    const creationTag: CreationTag =
      createdVia === "manual" ? "manual:create_contact" : "api:create_contact";

    const resolvedCompany = resolveContactCompanyFields({ orgId, company });
    if ("error" in resolvedCompany) {
      return NextResponse.json({ error: resolvedCompany.error }, { status: 400 });
    }

    // Ensure name is always provided (required by DB schema)
    const name =
      data.name ||
      [data.firstName, data.lastName].filter(Boolean).join(" ") ||
      "Unknown";

    const contactPayload = {
      ...data,
      name,
      ...(employments !== undefined ? { employments } : {}),
      ...(resolvedCompany.touched
        ? { company: resolvedCompany.company, orgId: resolvedCompany.orgId }
        : {}),
    };

    const identityPayload =
      identities && identities.length > 0 ? identities : identity ? [identity] : [];

    const contact = db.transaction(() => {
      const created = createContact(contactPayload, {
        tag: creationTag,
        workflowRunId: resolvedIds.workflowRunId,
        templateId: resolvedIds.templateId,
      });
      if (identityPayload.length > 0) {
        createContactIdentities(created.id, identityPayload);
      }
      return created;
    });

    // Re-fetch to include the newly created identity
    const { getContactById } = await import("@/lib/db/queries/contacts");
    const result = getContactById(contact.id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ChannelWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof EmploymentWriteError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (error instanceof PlatformAccountConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "A platform identity with this platform and user ID already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
