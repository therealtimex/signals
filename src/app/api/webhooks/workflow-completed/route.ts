import { NextRequest, NextResponse } from "next/server";
import { emitWorkflowCompletedEvent } from "@/lib/webhooks/workflow-events";

/**
 * Public/Internal Webhook endpoint triggered upon workflow completion.
 * Dispatches deterministic chaining or smart agentic routing.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";

    if (!runId) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: runId" },
        { status: 400 }
      );
    }

    const summary = typeof body.summary === "string" ? body.summary : undefined;
    const createdContactIds = Array.isArray(body.createdContactIds)
      ? body.createdContactIds.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
      : undefined;

    const result = await emitWorkflowCompletedEvent(runId, {
      summary,
      createdContactIds,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process workflow completed event";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
