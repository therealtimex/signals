import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { listContacts, createContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import { PlatformAccountConflictError } from "@/lib/db/identity-claims";
import { applyContactOrgLink, resolveContactCompanyFields } from "@/lib/contact-org-api";
import {
  contactIdentityInputSchema,
  createContactIdentities,
} from "@/lib/contact-identities-api";
import { channelInputSchema } from "@/lib/agent-tools/schemas";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

const createContactSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  orgId: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  title: z.string().optional(),
  platform: z.enum(PLATFORM_ENUM).optional(),
  platformUserId: z.string().optional(),
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
  score: z.number().int().min(0).optional(),
  isSelf: z.boolean().optional(),
  channels: z.array(channelInputSchema).optional(),
  identity: contactIdentityInputSchema.optional(),
  identities: z.array(contactIdentityInputSchema).optional(),
}).refine(
  (data) => data.name || data.firstName || data.lastName,
  { message: "At least name, firstName, or lastName is required" }
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const funnelStage = searchParams.get("funnelStage") ?? undefined;
  const platform = searchParams.get("platform") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") ?? "25", 10) || 25;

  const includeArchived = searchParams.get("includeArchived") === "true";

  const result = listContacts({ search, funnelStage, platform, page, pageSize, includeArchived });
  return NextResponse.json({ data: result.data, total: result.total });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identity, identities, orgId, company, platform: _platform, platformUserId: _platformUserId, ...data } =
      createContactSchema.parse(body);

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
      ...(resolvedCompany.touched ? { company: resolvedCompany.company } : {}),
    };

    const identityPayload =
      identities && identities.length > 0 ? identities : identity ? [identity] : [];

    const contact = db.transaction(() => {
      const created = createContact(contactPayload);
      if (resolvedCompany.touched) {
        applyContactOrgLink(
          created.id,
          {
            company: resolvedCompany.company,
            orgId: resolvedCompany.orgId,
          },
          "api:create_contact",
          contactPayload.title,
        );
      }
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
