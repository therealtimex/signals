import { NextRequest, NextResponse } from "next/server";
import {
  disconnectPlatformBrowserSession,
  getPlatformSessionStatus,
  openPlatformBrowserSession,
  validatePlatformBrowserSession,
} from "@/lib/platforms/browser-connection";

/**
 * POST /api/platforms/linkedin/browser-session
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "setup";

    switch (action) {
      case "setup": {
        const result = await openPlatformBrowserSession("linkedin");
        return NextResponse.json({
          status: "session_created",
          sessionName: result.sessionName,
        });
      }

      case "validate": {
        const result = await validatePlatformBrowserSession("linkedin");
        return NextResponse.json({
          status: result.isValid ? "valid" : "invalid",
          isValid: result.isValid,
          detectedHandle: result.detectedHandle,
          lastValidatedAt: result.lastValidatedAt,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Browser session operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/platforms/linkedin/browser-session
 */
export async function GET() {
  const status = await getPlatformSessionStatus("linkedin");
  return NextResponse.json({
    hasSession: status.hasSession,
    sessionRunning: status.sessionRunning,
    mode: status.mode,
    sessionName: status.sessionName,
    lastValidatedAt: status.lastValidatedAt,
    detectedHandle: status.detectedHandle,
  });
}

/**
 * DELETE /api/platforms/linkedin/browser-session
 */
export async function DELETE() {
  await disconnectPlatformBrowserSession("linkedin");
  return NextResponse.json({ status: "cleared" });
}
