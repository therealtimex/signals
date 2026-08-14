import { NextRequest, NextResponse } from "next/server";

/** Restrict agent tool API to localhost or an explicit bearer token. */
export function authorizeAgentToolRequest(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  const expected = process.env.SIGNALS_AGENT_TOOL_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        success: false,
        error: "Agent tool API is restricted to localhost unless SIGNALS_AGENT_TOOL_TOKEN is set",
        code: "FORBIDDEN",
      },
      { status: 403 }
    );
  }

  const header = request.headers.get("authorization");
  if (header === `Bearer ${expected}`) {
    return null;
  }

  return NextResponse.json(
    { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}
