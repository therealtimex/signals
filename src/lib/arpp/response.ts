import { NextRequest, NextResponse } from "next/server";
import type { ArppVisibility } from "@/lib/arpp/types";

export function readArppVisibility(
  request: NextRequest,
): { visibility: ArppVisibility } | { response: NextResponse } {
  const raw = request.nextUrl.searchParams.get("visibility") ?? "internal";
  if (raw !== "internal" && raw !== "public") {
    return {
      response: NextResponse.json(
        { error: "visibility must be internal or public" },
        { status: 400 },
      ),
    };
  }
  return { visibility: raw };
}

export function linkedDataResponse(request: NextRequest, document: unknown): NextResponse {
  const pretty = request.nextUrl.searchParams.get("pretty") === "1";
  return new NextResponse(JSON.stringify(document, null, pretty ? 2 : undefined), {
    headers: { "content-type": "application/ld+json; charset=utf-8" },
  });
}
