import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeAgentToolRequest } from "@/lib/agent-tools/auth";
import { invokeAgentTool } from "@/lib/agent-tools/invoke";
import { AgentToolError } from "@/lib/agent-tools/types";

const invokeBodySchema = z.object({
  tool: z.string().min(1),
  input: z.unknown().optional(),
});

/** Invoke a named agent tool with structured JSON input. */
export async function POST(request: NextRequest) {
  const denied = authorizeAgentToolRequest(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const parsed = invokeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Request body must include a tool name",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const result = await invokeAgentTool(parsed.data.tool, parsed.data.input ?? {});
    return NextResponse.json({
      success: true,
      tool: parsed.data.tool,
      result,
    });
  } catch (error) {
    if (error instanceof AgentToolError) {
      const status =
        error.code === "TOOL_NOT_FOUND" || error.code === "NOT_FOUND"
          ? 404
          : error.code === "VALIDATION_ERROR" ||
              error.code === "CAPABILITY_UNSUPPORTED" ||
              error.code === "TARGET_REQUIRED"
            ? 400
            : error.code === "CONFLICT" ||
                error.code === "AUDIT_STALE" ||
                error.code === "AUDIT_BLOCKED" ||
                error.code === "APPROVAL_REQUIRED" ||
                error.code === "STORE_CONFLICT"
              ? 409
              : error.code === "STORE_BUSY"
                ? 503
                : 500;

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status }
      );
    }

    return NextResponse.json(
      { success: false, error: "Internal server error", code: "EXECUTION_ERROR" },
      { status: 500 }
    );
  }
}
