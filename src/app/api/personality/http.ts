import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentToolError } from "@/lib/agent-tools/types";

export function personalityErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: error.flatten() },
      { status: 400 },
    );
  }
  if (error instanceof AgentToolError) {
    const status = error.code === "NOT_FOUND"
      ? 404
      : error.code === "VALIDATION_ERROR" || error.code === "CAPABILITY_UNSUPPORTED"
        ? 400
        : error.code === "WORKSPACE_UNAVAILABLE" || error.code === "STORE_BUSY"
          ? 503
          : error.code === "CONFLICT" || error.code === "STORE_CONFLICT"
            ? 409
            : 500;
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status },
    );
  }
  return NextResponse.json(
    { error: "Internal server error", code: "EXECUTION_ERROR" },
    { status: 500 },
  );
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AgentToolError("VALIDATION_ERROR", "Invalid JSON body");
  }
}
