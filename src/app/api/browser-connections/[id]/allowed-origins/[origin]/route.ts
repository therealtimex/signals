import { NextResponse } from "next/server";
import { allowedOriginsChangeStatus, removeAllowedOrigin } from "@/lib/platforms/allowed-websites";
import { findConnection, handleAllowedOriginsError } from "@/lib/platforms/allowed-websites-route";

/**
 * DELETE /api/browser-connections/[id]/allowed-origins/[origin]
 * `origin` is percent-encoded. Removing a Signals default is a 400.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; origin: string }> },
) {
  const connection = await findConnection(params);
  if (connection instanceof NextResponse) return connection;
  const { origin } = await params;

  let decoded: string;
  try {
    decoded = decodeURIComponent(origin);
  } catch {
    decoded = "";
  }
  try {
    const outcome = await removeAllowedOrigin(connection, decoded);
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });
    const status = outcome.result.removed ? allowedOriginsChangeStatus(outcome.result) : 200;
    return NextResponse.json(outcome.result, { status });
  } catch (error) {
    return handleAllowedOriginsError(error);
  }
}
