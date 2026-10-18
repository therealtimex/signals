import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";
import { personalityErrorResponse } from "@/app/api/personality/http";

/**
 * Error responses for `/api/objectives/*`.
 *
 * Same status mapping as the Personality routes, plus a stable `errorCode` taken from the error's
 * `details.reason` (for example `objective_exists`), so the run dialog keys its copy off a code
 * rather than off message text.
 */
export function objectivesErrorResponse(error: unknown): NextResponse {
  const response = personalityErrorResponse(error);
  if (error instanceof z.ZodError) return response;
  if (error instanceof AgentToolError) {
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        errorCode: typeof reason === "string" ? reason : error.code.toLowerCase(),
        details: error.details,
      },
      { status: response.status },
    );
  }
  return response;
}
