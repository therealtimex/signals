import { NextRequest, NextResponse } from "next/server";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { getSignalsRtxWorkspaceSlug } from "@/lib/rtx/cli-provisioning";
import {
  readAuthorizedEventReport,
  revokeEventAccessGrant,
} from "@/lib/workflows/event-sources/access";

export const dynamic = "force-dynamic";

function resolveRunOwnerWorkspace(runId: string): string {
  const run = getWorkflowRun(runId);
  try {
    const config = JSON.parse(run?.config ?? "{}") as Record<string, unknown>;
    if (typeof config.rtxWorkspaceSlug === "string" && config.rtxWorkspaceSlug.trim()) {
      return config.rtxWorkspaceSlug.trim();
    }
  } catch {
    // Legacy runs may have malformed config. Fall back to the server preference.
  }
  return getSignalsRtxWorkspaceSlug(process.env);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const capability = req.headers.get("x-signals-event-report-capability")?.trim() ?? "";
  if (!capability) {
    return NextResponse.json({ error: "Event report capability required" }, { status: 401 });
  }
  const report = readAuthorizedEventReport({
    runId: id,
    ownerWorkspace: resolveRunOwnerWorkspace(id),
    capability,
  });
  if (!report) {
    return NextResponse.json({ error: "Event report unavailable" }, { status: 403 });
  }
  return NextResponse.json(report, {
    headers: {
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const capability = req.headers.get("x-signals-event-report-capability")?.trim() ?? "";
  if (!capability) {
    return NextResponse.json({ error: "Event report capability required" }, { status: 401 });
  }
  const report = readAuthorizedEventReport({
    runId: id,
    ownerWorkspace: resolveRunOwnerWorkspace(id),
    capability,
  });
  if (!report) {
    return NextResponse.json({ error: "Event report unavailable" }, { status: 403 });
  }
  revokeEventAccessGrant(report.grantId);
  return new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store, private" },
  });
}
