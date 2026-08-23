import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContactById, updateContact, deleteContact } from "@/lib/db/queries/contacts";
import { channelInputSchema, employmentInputSchema } from "@/lib/agent-tools/schemas";
import { ChannelWriteError } from "@/lib/db/queries/contact-channel-writes";
import { EmploymentWriteError } from "@/lib/db/queries/contact-employment-writes";
import {
  getDeprecatedPlatformFieldsError,
  getImmutableBirthFieldsError,
  getUnsupportedIdentityFieldsError,
} from "@/lib/api/contact-route-validation";
import { resolveContactCompanyFields } from "@/lib/contact-org-api";

import {
  RELATIONSHIP_GOAL_ENUM,
  RELATIONSHIP_GOAL_STATUS_ENUM,
} from "@/lib/relationship-goals";

const updateContactSchema = z.object({
  name: z.string().min(1).optional(),
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
  relationshipGoal: z.enum(RELATIONSHIP_GOAL_ENUM).optional().nullable(),
  relationshipGoalStatus: z.enum(RELATIONSHIP_GOAL_STATUS_ENUM).optional().nullable(),
  score: z.number().int().min(0).optional(),
  isSelf: z.boolean().optional(),
  channels: z.array(channelInputSchema).optional(),
  employments: z.array(employmentInputSchema).optional(),
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
    const deprecatedError = getDeprecatedPlatformFieldsError(body);
    if (deprecatedError) {
      return NextResponse.json({ error: deprecatedError }, { status: 400 });
    }

    const birthError = getImmutableBirthFieldsError(body);
    if (birthError) {
      return NextResponse.json({ error: birthError }, { status: 400 });
    }

    const identityError = getUnsupportedIdentityFieldsError(body);
    if (identityError) {
      return NextResponse.json({ error: identityError }, { status: 400 });
    }

    const { orgId, company, employments, ...data } = updateContactSchema.parse(body);

    const resolvedCompany = resolveContactCompanyFields({ orgId, company });
    if ("error" in resolvedCompany) {
      return NextResponse.json({ error: resolvedCompany.error }, { status: 400 });
    }

    const updates: Record<string, unknown> = { ...data };
    if (employments !== undefined) {
      updates.employments = employments;
    }
    if (resolvedCompany.touched) {
      updates.company = resolvedCompany.company;
      updates.orgId = resolvedCompany.orgId;
    }

    const contact = updateContact(id, updates, "api:update_contact");

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json(contact);
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
