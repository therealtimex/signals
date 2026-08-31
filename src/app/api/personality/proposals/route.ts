import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody, personalityErrorResponse } from "@/app/api/personality/http";
import { proposePersonalityProjection } from "@/lib/personality/proposal";

const proposalSchema = z.object({
  voiceProfileId: z.string().regex(/^vp_[A-Za-z0-9_-]{6,}$/).optional(),
}).strict();

export async function POST(request: Request) {
  try {
    const input = proposalSchema.parse(await jsonBody(request));
    return NextResponse.json(await proposePersonalityProjection({
      ...input,
      origin: { kind: "ui" },
    }), { status: 201 });
  } catch (error) {
    return personalityErrorResponse(error);
  }
}
