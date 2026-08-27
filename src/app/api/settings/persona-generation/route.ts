import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/persona/agent-job";
import {
  isPersonaGenerationModeEnvLocked,
  PERSONA_GENERATION_MODES,
  resolvePersonaGenerationMode,
  setStoredPersonaGenerationMode,
  type PersonaModeResolution,
} from "@/lib/settings/persona-generation-mode";

const NOT_JSON = Symbol("not-json");

const putSchema = z.object({
  mode: z.enum(PERSONA_GENERATION_MODES),
});

export async function GET(): Promise<NextResponse<PersonaModeResolution>> {
  return NextResponse.json(resolvePersonaGenerationMode());
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => NOT_JSON);
  if (body === NOT_JSON) {
    return NextResponse.json(
      { error: "Request body must be valid JSON", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  let mode;
  try {
    ({ mode } = putSchema.parse(body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", code: "VALIDATION_ERROR", details: error.flatten() },
        { status: 400 },
      );
    }
    throw error;
  }

  if (isPersonaGenerationModeEnvLocked()) {
    return NextResponse.json(
      {
        error: "Persona generation mode is locked by SIGNALS_PERSONA_GENERATION_MODE in the environment.",
        code: "PERSONA_MODE_ENV_LOCKED",
      },
      { status: 409 },
    );
  }

  const current = resolvePersonaGenerationMode();
  const option = current.options.find((entry) => entry.value === mode);
  if (!option?.available) {
    return NextResponse.json(
      {
        error: "The requested persona generation mode is unavailable.",
        code: "PERSONA_MODE_UNAVAILABLE",
        unavailableReason: option?.unavailableReason ?? "backend_unavailable",
      },
      { status: 409 },
    );
  }

  setStoredPersonaGenerationMode(mode);
  return NextResponse.json(resolvePersonaGenerationMode());
}
