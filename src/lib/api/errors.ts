import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  CalibrationSourceError,
  SimulationAgentOwnershipError,
  SimulationRunStateError,
  SimulationScopeError,
} from "@/lib/db/queries/simulation-errors";
import {
  PersonaEvidenceError,
  PersonaGenerationUnavailableError,
  PersonaScopeError,
  PersonaSynthesisError,
} from "@/lib/db/queries/persona-errors";
import { OrgDomainConflictError, OrgValidationError } from "@/lib/orgs/errors";

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

  if (error instanceof OrgValidationError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: 400 },
    );
  }

  if (error instanceof OrgDomainConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: { domain: error.domain, orgId: error.orgId },
      },
      { status: 409 },
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

  if (error instanceof PersonaEvidenceError || error instanceof PersonaScopeError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 409 },
    );
  }

  if (error instanceof PersonaSynthesisError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 502 },
    );
  }

  if (error instanceof PersonaGenerationUnavailableError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 503 },
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
