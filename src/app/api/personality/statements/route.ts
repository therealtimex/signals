import { NextResponse } from "next/server";
import { AgentToolError } from "@/lib/agent-tools/types";
import { handleUpsertPersonalityStatements } from "@/lib/agent-tools/personality-handlers";
import { personalityStatementsInputSchema } from "@/lib/personality/contracts";
import {
  emptyPersonalityStatements,
  readPersonalityStatements,
} from "@/lib/personality/statements";

export async function GET() {
  return NextResponse.json(readPersonalityStatements() ?? emptyPersonalityStatements());
}

export async function PUT(request: Request) {
  const parsed = personalityStatementsInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await handleUpsertPersonalityStatements(parsed.data));
  } catch (error) {
    if (error instanceof AgentToolError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.code === "STORE_BUSY" ? 503 : 409 },
      );
    }
    throw error;
  }
}
