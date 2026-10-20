import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody } from "@/app/api/personality/http";
import { objectivesErrorResponse } from "@/app/api/objectives/http";
import { resolvePersonalityWorkspace } from "@/lib/personality/workspace";
import { previewObjectiveBrief } from "@/lib/writing/account-objective";

const previewSchema = z.object({ text: z.string() }).strict();

/**
 * POST /api/objectives/preview — what a brief would attach to a run, without dispatching:
 * parsed headings, resolved mentions, the offering and the limitations.
 */
export async function POST(request: Request) {
  try {
    const body = previewSchema.parse(await jsonBody(request));
    const preview = await previewObjectiveBrief({
      text: body.text,
      resolveWorkspace: () => resolvePersonalityWorkspace(),
    });
    return NextResponse.json(preview);
  } catch (error) {
    return objectivesErrorResponse(error);
  }
}
