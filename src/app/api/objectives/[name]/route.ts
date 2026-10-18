import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonBody } from "@/app/api/personality/http";
import { objectivesErrorResponse } from "@/app/api/objectives/http";
import { AgentToolError } from "@/lib/agent-tools/types";
import { resolvePersonalityWorkspace } from "@/lib/personality/workspace";
import {
  isObjectiveBriefName,
  objectiveBriefPath,
  readSavedObjectiveBrief,
  writeSavedObjectiveBrief,
} from "@/lib/rtx/objective-brief-files";

const putSchema = z.object({
  text: z.string(),
  overwrite: z.boolean().optional(),
}).strict();

function assertName(name: string): void {
  if (!isObjectiveBriefName(name)) {
    throw new AgentToolError(
      "VALIDATION_ERROR",
      "Use 2 to 63 lowercase letters, numbers and dashes, starting with a letter or number",
      { reason: "invalid_name", name },
    );
  }
}

/** GET /api/objectives/[name] — one saved brief's text. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    assertName(name);
    const workspace = await resolvePersonalityWorkspace();
    const file = readSavedObjectiveBrief(workspace, name);
    if (!file) {
      throw new AgentToolError("NOT_FOUND", `Saved brief not found: ${objectiveBriefPath(name)}`, {
        reason: "objective_not_found",
        path: objectiveBriefPath(name),
      });
    }
    return NextResponse.json({
      name,
      path: file.path,
      text: file.content,
      fileHash: file.fileHash,
      updatedAt: Math.floor(file.mtimeMs / 1000),
    });
  } catch (error) {
    return objectivesErrorResponse(error);
  }
}

/**
 * PUT /api/objectives/[name] — save a brief as `objectives/<name>.md`.
 *
 * Refuses an existing name with `409 objective_exists` unless `overwrite` is true. The run dialog
 * never sends `overwrite`: editing a brief that runs already use would revoke their approvals, so
 * that edit happens in the workspace on purpose.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    assertName(name);
    const body = putSchema.parse(await jsonBody(request));
    const workspace = await resolvePersonalityWorkspace();
    const brief = writeSavedObjectiveBrief(workspace, { name, text: body.text, overwrite: body.overwrite });
    return NextResponse.json({ brief }, { status: 201 });
  } catch (error) {
    return objectivesErrorResponse(error);
  }
}
