import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLATFORM_ENUM } from "@/lib/db/platforms";
import { getContactById, recalcEnrichment } from "@/lib/db/queries/contacts";
import { createIdentity, listIdentitiesByContact } from "@/lib/db/queries/identities";

const createIdentitySchema = z.object({
  platform: z.enum(PLATFORM_ENUM),
  platformUserId: z.string().min(1),
  platformHandle: z.string().optional(),
  platformUrl: z.string().optional(),
  platformData: z.string().optional(),
  isPrimary: z.boolean().optional(),
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
  const identities = listIdentitiesByContact(id);
  return NextResponse.json(identities);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const contact = getContactById(id);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = await req.json();
    const data = createIdentitySchema.parse(body);

    const identity = createIdentity({
      contactId: id,
      platform: data.platform,
      platformUserId: data.platformUserId,
      platformHandle: data.platformHandle,
      platformUrl: data.platformUrl,
      platformData: data.platformData,
      isPrimary: data.isPrimary ? 1 : 0,
    });

    recalcEnrichment(id);

    return NextResponse.json(identity, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
