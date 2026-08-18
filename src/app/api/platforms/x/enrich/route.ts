import { NextRequest, NextResponse } from "next/server";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { listSyncCursors } from "@/lib/db/queries/sync";
import {
  BROWSER_ENRICHMENT_MESSAGE,
  syncXProfiles,
} from "@/lib/platforms/sync-x-profiles";
import { runSyncWorkflow } from "@/lib/workflows/run-sync-workflow";

/**
 * POST /api/platforms/x/enrich
 * Records an enrich workflow run. In-process browser enrichment was removed —
 * use RTX agent-browser + agent-tools instead (docs/rtx-agent-browser-enrichment.md).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const account = getPlatformAccountByPlatform("x");
    // Credential-less archive-import placeholders get the migration no-op
    // instead of recording a junk failed enrich run.
    if (!account || !account.credentialsEncrypted) {
      return NextResponse.json({
        success: false,
        delegated: true,
        message: BROWSER_ENRICHMENT_MESSAGE,
        migrationDoc: "docs/rtx-agent-browser-enrichment.md",
      });
    }

    const maxProfiles = body.maxProfiles ?? 15;

    const { workflowRun, syncResult } = await runSyncWorkflow({
      workflowType: "enrich",
      syncSubType: "x_enrich",
      platformAccountId: account.id,
      syncFunction: () =>
        syncXProfiles(account.id, {
          contactIds: body.contactIds,
          maxProfiles,
        }),
    });

    const delegated = syncResult.errors.length > 0 && syncResult.updated === 0;

    return NextResponse.json({
      success: !delegated,
      delegated,
      message: delegated ? BROWSER_ENRICHMENT_MESSAGE : undefined,
      result: syncResult,
      workflowRunId: workflowRun.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/platforms/x/enrich
 * Enrichment status and migration guidance.
 */
export async function GET() {
  const account = getPlatformAccountByPlatform("x");
  if (!account) {
    return NextResponse.json({
      configured: false,
      delegatedToRtx: true,
      message: BROWSER_ENRICHMENT_MESSAGE,
      migrationDoc: "docs/rtx-agent-browser-enrichment.md",
    });
  }

  const cursors = listSyncCursors(account.id);
  const enrichCursor = cursors.find((c) => c.dataType === "x_profiles");

  return NextResponse.json({
    configured: true,
    delegatedToRtx: true,
    migrationDoc: "docs/rtx-agent-browser-enrichment.md",
    enrichment: enrichCursor
      ? {
          status: enrichCursor.syncStatus,
          totalEnriched: enrichCursor.totalItemsSynced,
          lastEnrichedAt: enrichCursor.lastSyncCompletedAt,
          lastError: enrichCursor.lastError,
        }
      : null,
  });
}
