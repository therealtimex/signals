import { NextResponse } from "next/server";
import { allowedOriginsChangeStatus, reapplyAllowedOrigins } from "@/lib/platforms/allowed-websites";
import {
  findConnection,
  handleAllowedOriginsError,
  type ConnectionRouteContext,
} from "@/lib/platforms/allowed-websites-route";

/**
 * POST /api/browser-connections/[id]/allowed-origins/apply
 * Re-apply the saved list to RealTimeX and read it back: the "Try again" for a 502.
 */
export async function POST(_request: Request, { params }: ConnectionRouteContext) {
  const connection = await findConnection(params);
  if (connection instanceof NextResponse) return connection;
  try {
    const change = await reapplyAllowedOrigins(connection);
    return NextResponse.json(change, { status: allowedOriginsChangeStatus(change) });
  } catch (error) {
    return handleAllowedOriginsError(error);
  }
}
