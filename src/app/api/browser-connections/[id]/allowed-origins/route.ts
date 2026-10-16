import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addAllowedOrigin,
  allowedOriginsChangeStatus,
  buildAllowedOriginsView,
} from "@/lib/platforms/allowed-websites";
import {
  findConnection,
  handleAllowedOriginsError,
  type ConnectionRouteContext,
} from "@/lib/platforms/allowed-websites-route";

/**
 * GET /api/browser-connections/[id]/allowed-origins
 * The Signals defaults, the websites the user added, and what RealTimeX holds (#547, ADR-547-6).
 */
export async function GET(_request: Request, { params }: ConnectionRouteContext) {
  const connection = await findConnection(params);
  if (connection instanceof NextResponse) return connection;
  return NextResponse.json(await buildAllowedOriginsView(connection));
}

const addSchema = z.object({
  url: z.unknown(),
  source: z.enum(["settings", "recovery"]).default("settings"),
});

/**
 * POST /api/browser-connections/[id]/allowed-origins { url, source? }
 * 200 added and active (or nothing to change); 502 saved but RealTimeX didn't take it; 400 for a
 * link that can't be allowed; 403 for signals-publish on a Dev instance.
 */
export async function POST(request: Request, { params }: ConnectionRouteContext) {
  const connection = await findConnection(params);
  if (connection instanceof NextResponse) return connection;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  const input = {
    url: parsed.success ? parsed.data.url : undefined,
    source: parsed.success ? parsed.data.source : ("settings" as const),
  };
  try {
    const outcome = await addAllowedOrigin(connection, input);
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status });
    const status = outcome.result.status === "added" ? allowedOriginsChangeStatus(outcome.result) : 200;
    return NextResponse.json(outcome.result, { status });
  } catch (error) {
    return handleAllowedOriginsError(error);
  }
}
