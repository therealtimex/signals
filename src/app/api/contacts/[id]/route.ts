import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { getContactById, updateContact, deleteContact } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/client";
import {
  applyContactOrgLink,
  resolveContactCompanyFields,
  shouldSyncCompanyGraphOnUpdate,
  syncContactCompanyFromContact,
} from "@/lib/contact-org-api";

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  orgId: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  title: z.string().optional(),
  platform: z.enum(PLATFORM_ENUM).nullable().optional(),
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
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contact = getContactById(id);
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json(contact);
}

async function updateContactHandler(
  req: NextRequest,
  id: string,
): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { orgId, company, ...data } = updateContactSchema.parse(body);

    const resolvedCompany = resolveContactCompanyFields({ orgId, company });
    if ("error" in resolvedCompany) {
      return NextResponse.json({ error: resolvedCompany.error }, { status: 400 });
    }

    const updates: Record<string, unknown> = { ...data };
    if (resolvedCompany.touched) {
      updates.company = resolvedCompany.company;
    }

    const syncGraph = shouldSyncCompanyGraphOnUpdate({ orgId, company, title: data.title });

    const contact = syncGraph
      ? db.transaction(() => {
          const updated = updateContact(id, updates);
          if (!updated) return undefined;

          if (resolvedCompany.touched) {
            applyContactOrgLink(
              updated.id,
              {
                company: resolvedCompany.company,
                orgId: resolvedCompany.orgId,
              },
              "api:update_contact",
              updated.title,
            );
          } else {
            syncContactCompanyFromContact(
              updated.id,
              updated.company,
              updated.title,
              "api:update_contact",
            );
          }

          return updated;
        })
      : updateContact(id, updates);

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json(contact);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return updateContactHandler(req, id);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return updateContactHandler(req, id);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const deleted = deleteContact(id);
    if (!deleted) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete contact";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
