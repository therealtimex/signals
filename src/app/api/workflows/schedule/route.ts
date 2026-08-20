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

    // A dedupe template has no agent to dispatch, so it schedules as a maintenance sweep
    // that runs the merge engine in-process — the one job type that actually executes.
    const template = getTemplate(data.templateId);
    const isDedupe = template
      ? isDedupeTemplateConfig(parseTemplateConfig(template.config))
      : false;
    const payload = {
      ...(data.payload ?? {}),
      ...(isDedupe ? { templateId: data.templateId } : {}),
    };

    const job = createScheduledJob({
      jobType: isDedupe ? DEDUPE_MERGE_JOB_TYPE : "workflow",
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
