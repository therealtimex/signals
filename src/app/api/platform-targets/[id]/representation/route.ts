import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, personalityErrorResponse } from "@/app/api/personality/http";
import { setTargetRepresentation } from "@/lib/personality/use-cases";
import { targetRepresentationSchema } from "@/lib/writing/personality-lineage";

const putSchema = z.object({
  bindingId: z.string().regex(/^pb_[A-Za-z0-9_-]{6,}$/),
  represents: targetRepresentationSchema,
}).strict();

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = putSchema.parse(await jsonBody(request));
    return NextResponse.json(await setTargetRepresentation({
      targetId: id,
      bindingId: input.bindingId,
      represents: input.represents,
      evidence: { kind: "ui", route: "/settings/personality" },
    }));
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
