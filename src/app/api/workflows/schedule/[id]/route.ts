import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import {
  getScheduledJob,
  updateScheduledJob,
  deleteScheduledJob,
  reactivateScheduledJob,
} from "@/lib/db/queries/scheduled-jobs";
import {
  RTX_SCHEDULING_REQUIRED_CODE,
  RTX_SCHEDULING_REQUIRED_MESSAGE,
  canReactivateScheduleLocally,
} from "@/lib/scheduler/schedule-policy";

const updateScheduleSchema = z.object({
  cronExpression: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/workflows/schedule/[id]
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getScheduledJob(id);

  if (!job) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  return NextResponse.json(job);
}

/**
 * PUT /api/workflows/schedule/[id]
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json();
    const data = updateScheduleSchema.parse(body);

    // Validate cron expression if provided
    if (data.cronExpression) {
      try {
        CronExpressionParser.parse(data.cronExpression);
      } catch {
        return NextResponse.json(
          { error: "Invalid cron expression" },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (data.cronExpression !== undefined) updates.cronExpression = data.cronExpression;
    if (data.payload !== undefined) updates.payload = JSON.stringify(data.payload);

    let job;
    if (data.enabled === true) {
      const existing = getScheduledJob(id);
      if (!existing) {
        return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
      }
      if (!canReactivateScheduleLocally(existing)) {
        return NextResponse.json(
          { error: RTX_SCHEDULING_REQUIRED_MESSAGE, code: RTX_SCHEDULING_REQUIRED_CODE },
          { status: 409 },
        );
      }
      job = reactivateScheduledJob(id);
      if (!job) {
        return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
      }
      if (data.cronExpression !== undefined || data.payload !== undefined) {
        job = updateScheduledJob(id, updates) ?? job;
      }
    } else {
      if (data.enabled === false) updates.enabled = 0;
      job = updateScheduledJob(id, updates);
      if (!job) {
        return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
      }
    }

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workflows/schedule/[id]
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = deleteScheduledJob(id);

  if (!deleted) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
