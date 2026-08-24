import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowTemplates } from "@/lib/db/schema";
import { createWorkflowRun } from "@/lib/db/queries/workflows";
import { mapTemplateTypeToWorkflowType } from "@/lib/workflows/chaining";
import {
  buildWorkflowCascadeConfig,
  CASCADE_CONFIG_KEY,
  type FollowOnActionType,
} from "@/lib/workflows/cascade-types";
import { verifyHmacSignature } from "@/lib/webhooks/workflow-events";

/**
 * POST /api/webhooks/trigger
 * Inbound webhook endpoint allowing RealTimeX, external webhooks, or automation tools
 * to trigger a workflow run in Signals.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const secret = process.env.SIGNALS_WEBHOOK_SECRET ?? process.env.REALTIMEX_WEBHOOK_SECRET;

    if (secret) {
      const signature =
        req.headers.get("x-realtimex-signature") ??
        req.headers.get("x-signals-signature") ??
        req.headers.get("x-hub-signature-256") ??
        req.headers.get("authorization");

      const isValid = verifyHmacSignature(rawBody, signature, secret);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: "Invalid or missing HMAC webhook signature" },
          { status: 401 }
        );
      }
    }

    const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
    const templateName =
      (typeof payload.templateName === "string" && payload.templateName.trim()) ||
      "Network Snowball";
    const templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : null;

    let template = null;
    if (templateId) {
      template = db.select().from(workflowTemplates).where(eq(workflowTemplates.id, templateId)).get();
    } else {
      template = db.select().from(workflowTemplates).where(eq(workflowTemplates.name, templateName)).get();
    }

    if (!template) {
      return NextResponse.json(
        { success: false, error: `Workflow template '${templateName}' not found` },
        { status: 404 }
      );
    }

    const baseTemplateConfig = JSON.parse(template.config ?? "{}") as Record<string, unknown>;
    const customConfig = (payload.config as Record<string, unknown> | undefined) ?? payload;

    const followOnActions = Array.isArray(customConfig.followOnActions)
      ? (customConfig.followOnActions as FollowOnActionType[])
      : typeof customConfig.followOnAction === "string"
      ? [customConfig.followOnAction as FollowOnActionType]
      : [];

    const mergedConfig = {
      ...baseTemplateConfig,
      ...customConfig,
      [CASCADE_CONFIG_KEY]: buildWorkflowCascadeConfig({
        followOnActions,
        cascadePolicy: customConfig.cascadePolicy === "supervised" ? "supervised" : "immediate",
      }),
    };

    const run = createWorkflowRun({
      templateId: template.id,
      workflowType: mapTemplateTypeToWorkflowType(template.templateType),
      status: "pending",
      trigger: "template",
      config: JSON.stringify(mergedConfig),
    });

    return NextResponse.json({
      success: true,
      runId: run.id,
      templateName: template.name,
      status: run.status,
      trigger: "webhook",
      message: `Triggered workflow run for ${template.name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process webhook trigger";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
