import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { notFoundResponse } from "@/lib/api/errors";
import { INTERACTION_TYPES } from "@/lib/db/interaction-types";
import { getContactById } from "@/lib/db/queries/contacts";
import {
  countInteractionAttachments,
  InteractionError,
  logInteraction,
} from "@/lib/db/queries/interactions";

const createInteractionSchema = z.object({
  interactionType: z.enum(INTERACTION_TYPES),
  summary: z.string().optional(),
  direction: z.enum(["inbound", "outbound", "mutual"]).optional(),
  isMeaningful: z.boolean().optional(),
  scope: z.enum(["shared", "local_only"]).optional(),
  occurredAt: z.number().int().optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: contactId } = await params;
  if (!getContactById(contactId)) {
    return notFoundResponse("Contact not found");
  }

  try {
    const body = createInteractionSchema.parse(await req.json());
    const interaction = logInteraction({
      contactId,
      interactionType: body.interactionType,
      summary: body.summary,
      direction: body.direction,
      isMeaningful: body.isMeaningful,
      scope: body.scope,
      occurredAt: body.occurredAt,
      attachmentIds: body.attachmentIds,
      source: "api:manual_log",
    });

    return NextResponse.json(
      {
        id: interaction.id,
        interactionType: interaction.interactionType,
        occurredAt: interaction.occurredAt,
        scope: interaction.scope,
        attachmentCount: countInteractionAttachments(interaction.id),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = error instanceof InteractionError || error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
