import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CalibrationSourceError,
  SimulationAgentOwnershipError,
  SimulationRunStateError,
  SimulationScopeError,
} from "@/lib/db/queries/simulation-errors";

export type ApiErrorBody = {
  error: string;
  code: string;
  details?: unknown;
};

export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.flatten(),
      },
      { status: 400 },
    );
  }

  if (error instanceof SimulationScopeError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409 },
    );
  }

  if (error instanceof SimulationRunStateError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409 },
    );
  }

  if (error instanceof CalibrationSourceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409 },
    );
  }

  if (error instanceof SimulationAgentOwnershipError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function notFoundResponse(
  message: string,
  code = "NOT_FOUND",
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, code }, { status: 404 });
}

export function badRequestResponse(message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, code: "BAD_REQUEST" }, { status: 400 });
}
