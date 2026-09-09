import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";
import { dispatchSnowballCalendarTask } from "@/lib/rtx/snowball-calendar-dispatch";
import { NETWORK_SNOWBALL_TEMPLATE_NAME } from "@/lib/workflows/network-snowball";

const calendarDispatchSchema = z.object({
  calendarEventUuid: z.string().min(1),
  taskUuid: z.string().uuid(),
  dispatchKind: z.literal("workflow.run"),
  workflowTemplate: z.literal(NETWORK_SNOWBALL_TEMPLATE_NAME),
  workflowRunConfig: z.record(z.unknown()),
}).passthrough();

/**
 * Stable, idempotent target for the otherwise free-form Calendar dispatcher.
 * The Calendar agent forwards its injected context; Signals owns launch,
 * external-task acknowledgement, and dispatcher-session release from here.
 */
export async function POST(req: NextRequest) {
  try {
    const context = calendarDispatchSchema.parse(await req.json());
    const result = await dispatchSnowballCalendarTask(
      context,
      resolveSignalsBaseUrlFromRequest(req),
    );
    return NextResponse.json(result, { status: result.success ? 201 : 502 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid Snowball calendar dispatch context", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Snowball calendar dispatch failed",
      },
      { status: 500 },
    );
  }
}
