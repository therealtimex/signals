import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { notFoundResponse, toErrorResponse } from "@/lib/api/errors";
import { getContactExploreCard } from "@/lib/db/queries/contact-explore";
import { getContactById } from "@/lib/db/queries/contacts";
import { generatePersona } from "@/lib/workflows/generate-persona";

const bodySchema = z.object({
  force: z.boolean().optional().default(false),
});

async function readJsonBody(
  req: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const raw = await req.text();
  if (raw.trim() === "") {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          details: {
            formErrors: ["Invalid JSON body"],
            fieldErrors: {},
          },
        },
        { status: 400 },
      ),
    };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const contact = getContactById(id);
  if (!contact) {
    return notFoundResponse("Contact not found");
  }

  let body: unknown = {};
  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  body = parsedBody.body;

  try {
    const { force } = bodySchema.parse(body);
    const before = getContactExploreCard(id);
    const shouldForce = force || before?.persona.stale === true;

    const result = await generatePersona(id, {
      force: shouldForce,
      trigger: "user",
    });

    const persona = getContactExploreCard(id)!.persona;

    if (!result.generated) {
      return NextResponse.json({
        generated: false,
        skipped: true,
        reason: result.reason,
        persona,
      });
    }

    return NextResponse.json({
      generated: true,
      persona,
      workflowRunId: result.workflowRunId,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
