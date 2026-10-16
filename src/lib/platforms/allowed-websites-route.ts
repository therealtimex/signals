/** Shared pieces of the `/api/browser-connections/[id]/allowed-origins` route handlers. */
import { NextResponse } from "next/server";
import { getBrowserConnectionById } from "@/lib/db/queries/platform-targets";
import type { BrowserConnection } from "@/lib/db/types";
import {
  ExternalEffectDeniedError,
  externalEffectDeniedResponse,
} from "@/lib/instance/guard";
import { allowedOriginsError } from "@/lib/platforms/allowed-websites";

export type ConnectionRouteContext = { params: Promise<{ id: string }> };

export async function findConnection(
  params: Promise<{ id: string }>,
): Promise<BrowserConnection | NextResponse> {
  const { id } = await params;
  return (
    getBrowserConnectionById(id) ??
    NextResponse.json(allowedOriginsError("not_found"), { status: 404 })
  );
}

/** The Dev-instance guard answers 403 (ADR-547-10); anything else is a real failure. */
export function handleAllowedOriginsError(error: unknown): NextResponse {
  if (error instanceof ExternalEffectDeniedError) return externalEffectDeniedResponse(error);
  throw error;
}
