import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, personalityErrorResponse } from "@/app/api/personality/http";
import { proposePersonalityRollback } from "@/lib/personality/proposal";

const rollbackSchema = z.object({
  bindingId: z.string().regex(/^pb_[A-Za-z0-9_-]{6,}$/),
}).strict();

export async function POST(request: Request) {
  try {
    const input = rollbackSchema.parse(await jsonBody(request));
    return NextResponse.json(await proposePersonalityRollback(
      input.bindingId,
      { kind: "ui" },
    ), { status: 201 });
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
