import { NextResponse } from "next/server";
import {
  getBrowserConnectionById,
  listBrowserConnections,
  resolveDefaultTarget,
} from "@/lib/db/queries/platform-targets";
import {
  listRtxBrowserSessions,
  resolveRtxDebugPort,
} from "@/lib/rtx/browser-sessions";

export async function GET(request: Request) {
  const requestedPlatform = new URL(request.url).searchParams.get("targetPlatform");
  const targetPlatform = requestedPlatform === "x" ? "x" : "linkedin";
  try {
    const runtimeSessions = await listRtxBrowserSessions();
    const runningNames = new Set(runtimeSessions
      .filter((entry) => entry.running !== false && resolveRtxDebugPort(entry) !== null)
      .map((entry) => entry.sessionName));
    const sessions = listBrowserConnections()
      .filter((connection) => runningNames.has(connection.sessionName))
      .map((connection) => ({
        sessionName: connection.sessionName,
        running: true as const,
        sourceIdentity: null,
        identityVerification: "checked_at_launch" as const,
      }))
      .sort((a, b) => a.sessionName.localeCompare(b.sessionName));

    const target = resolveDefaultTarget(targetPlatform);
    const connection = target ? getBrowserConnectionById(target.connectionId) : undefined;
    const crmTarget = target && connection
      ? {
          platform: targetPlatform,
          sessionName: connection.sessionName,
          identity: target.handle ?? target.name,
          verification: target.lastVerifiedAt ? "previously_verified" as const : "unverified" as const,
          lastVerifiedAt: target.lastVerifiedAt,
        }
      : null;

    return NextResponse.json({ success: true, sessions, crmTarget });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Browser sessions are unavailable",
    }, { status: 503 });
  }
}
