import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { notFoundResponse } from "@/lib/api/errors";
import { getContactById } from "@/lib/db/queries/contacts";
import {
  getContactRelationship,
  upsertContactRelationship,
} from "@/lib/db/queries/contact-relationship";

const updateRelationshipSchema = z.object({
  stage: z.enum(["stranger", "acquaintance", "warm", "close", "inner_circle"]).nullable().optional(),
  warmth: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  relationshipType: z.enum(["professional", "personal", "mixed"]).nullable().optional(),
  desiredDirection: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  if (!getContactById(contactId)) {
    return notFoundResponse("Contact not found");
  }

  return NextResponse.json({ relationship: getContactRelationship(contactId) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  if (!getContactById(contactId)) {
    return notFoundResponse("Contact not found");
  }

  try {
    const body = updateRelationshipSchema.parse(await req.json());
    const relationship = upsertContactRelationship({
      contactId,
      stage: body.stage,
      warmth: body.warmth,
      notes: body.notes,
      relationshipType: body.relationshipType,
      desiredDirection: body.desiredDirection,
      context: body.context,
    });
    return NextResponse.json({ relationship });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
