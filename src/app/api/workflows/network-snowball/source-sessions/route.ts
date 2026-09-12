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
  const searchParams = new URL(request.url).searchParams;
  const requestedPlatform = searchParams.get("targetPlatform");
  const includeSourceSessions = searchParams.get("includeSourceSessions") === "true";
  const targetPlatform = requestedPlatform === "x" ? "x" : "linkedin";
  try {
    const sessions = includeSourceSessions
      ? await listRtxBrowserSessions().then((runtimeSessions) => {
          const runningNames = new Set<string>();
          for (const entry of runtimeSessions) {
            if (entry.running !== false && resolveRtxDebugPort(entry) !== null) {
              runningNames.add(entry.sessionName);
            }
          }
          const runningConnections = [];
          for (const connection of listBrowserConnections()) {
            if (!runningNames.has(connection.sessionName)) continue;
            runningConnections.push({
              sessionName: connection.sessionName,
              running: true as const,
              sourceIdentity: null,
              identityVerification: "checked_at_launch" as const,
            });
          }
          return runningConnections.sort((a, b) => a.sessionName.localeCompare(b.sessionName));
        })
      : [];

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
