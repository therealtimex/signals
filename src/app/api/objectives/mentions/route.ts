import { NextResponse } from "next/server";
import { objectivesErrorResponse } from "@/app/api/objectives/http";
import { resolvePersonalityWorkspace } from "@/lib/personality/workspace";
import { listObjectiveMentionTargets } from "@/lib/writing/account-objective";

/**
 * GET /api/objectives/mentions — what the run dialog's `@` list may offer: the PRODUCTS.md
 * entries, then the allowlisted Personality files that exist in the workspace.
 */
export async function GET() {
  try {
    const workspace = await resolvePersonalityWorkspace();
    return NextResponse.json(listObjectiveMentionTargets(workspace));
  } catch (error) {
    return objectivesErrorResponse(error);
  }
}
