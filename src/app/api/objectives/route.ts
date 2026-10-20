import { NextResponse } from "next/server";
import { objectivesErrorResponse } from "@/app/api/objectives/http";
import { resolvePersonalityWorkspace } from "@/lib/personality/workspace";
import {
  listSavedObjectiveBriefs,
} from "@/lib/rtx/objective-brief-files";

/** GET /api/objectives — saved Objective briefs in the Signals workspace, newest first. */
export async function GET() {
  try {
    const workspace = await resolvePersonalityWorkspace();
    return NextResponse.json({ briefs: listSavedObjectiveBriefs(workspace) });
  } catch (error) {
    return objectivesErrorResponse(error);
  }
}
