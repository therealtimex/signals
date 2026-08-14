import { NextRequest, NextResponse } from "next/server";
import { authorizeAgentToolRequest } from "@/lib/agent-tools/auth";
import { listAgentToolsManifest } from "@/lib/agent-tools/registry";

/** List available agent tools with JSON Schema parameters. */
export async function GET(request: NextRequest) {
  const denied = authorizeAgentToolRequest(request);
  if (denied) return denied;

  return NextResponse.json({
    success: true,
    ...listAgentToolsManifest(),
  });
}
