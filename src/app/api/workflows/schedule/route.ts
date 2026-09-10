import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import {
  listScheduledJobs,
  createScheduledJob,
} from "@/lib/db/queries/scheduled-jobs";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import { isDedupeTemplateConfig } from "@/lib/workflows/dedupe-template";
import { DEDUPE_MERGE_JOB_TYPE } from "@/lib/contacts/dedupe/scheduled-merge";
import {
  RTX_SCHEDULING_REQUIRED_CODE,
  RTX_SCHEDULING_REQUIRED_MESSAGE,
} from "@/lib/scheduler/schedule-policy";

const createScheduleSchema = z.object({
  templateId: z.string().min(1, "templateId is required"),
  cronExpression: z.string().min(1, "cronExpression is required"),
  payload: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/workflows/schedule
 * List all scheduled jobs.
 */
export async function GET() {
  const jobs = listScheduledJobs();
  return NextResponse.json({ data: jobs });
}

/**
 * POST /api/workflows/schedule
 * Create a new scheduled job for a workflow template.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createScheduleSchema.parse(body);

    // Validate cron expression
    try {
      CronExpressionParser.parse(data.cronExpression);
    } catch {
      return NextResponse.json(
        { error: "Invalid cron expression" },
        { status: 400 }
      );
    }

    const template = getTemplate(data.templateId);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // A dedupe template has no agent to dispatch, so it schedules as a maintenance sweep
    // that runs the merge engine in-process — the one job type that actually executes.
    // Anything else would only be recorded here to fail on first fire, so refuse it up front:
    // the host app owns recurring runs (RealTimeX Agent Flow or calendar event).
    const isDedupe = isDedupeTemplateConfig(parseTemplateConfig(template.config));
    if (!isDedupe) {
      return NextResponse.json(
        { error: RTX_SCHEDULING_REQUIRED_MESSAGE, code: RTX_SCHEDULING_REQUIRED_CODE },
        { status: 409 },
      );
    }

    const payload = { ...(data.payload ?? {}), templateId: data.templateId };

    const job = createScheduledJob({
      jobType: DEDUPE_MERGE_JOB_TYPE,
      templateId: data.templateId,
      cronExpression: data.cronExpression,
      payload: JSON.stringify(payload),
      enabled: data.enabled !== false ? 1 : 0,
    });

    return NextResponse.json(job, { status: 201 });
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
