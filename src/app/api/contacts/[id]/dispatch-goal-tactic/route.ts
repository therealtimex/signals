import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContactById, updateContact } from "@/lib/db/queries/contacts";
import { getActivePersona } from "@/lib/db/queries/personas";
import { createTask } from "@/lib/db/queries/tasks";
import { getSystemTemplateByName } from "@/lib/db/queries/workflow-templates";
import { seedTemplates } from "@/lib/db/seed-templates";
import { generateGoalTactic } from "@/lib/personas/goal-tactics";
import { RELATIONSHIP_GOAL_ENUM } from "@/lib/relationship-goals";
import { CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME } from "@/lib/workflows/contact-relationship-nurture";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import { runTemplateViaRtx } from "@/lib/agents/run-template-via-rtx";
import { resolveSignalsBaseUrlFromRequest } from "@/lib/rtx/resolve-signals-base-url";

const dispatchSchema = z.object({
  goal: z.enum(RELATIONSHIP_GOAL_ENUM).optional(),
  customPrompt: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const contact = getContactById(id);
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found", errorCode: "not_found" },
        { status: 404 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const data = dispatchSchema.parse(body);

    const persona = getActivePersona(id, { includeLocalOnly: true });
    const tactic = generateGoalTactic(contact, persona, data.goal ?? "follow_back");
    if (!tactic) {
      return NextResponse.json(
        { error: "Could not generate relationship goal tactic for contact" },
        { status: 400 },
      );
    }

    let template = getSystemTemplateByName(CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME);
    if (!template) {
      seedTemplates();
      template = getSystemTemplateByName(CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME);
    }

    const task = createTask({
      title: `[${tactic.goalLabel}] ${tactic.headline}`,
      description: `${tactic.strategy}\n\nRecommended Action Steps:\n${tactic.recommendedActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\nSuggested Draft Copy:\n"${tactic.suggestedDraft}"\n\nRealTimeX Agent Instructions:\n${tactic.agentPrompt}`,
      taskType: "follow_up",
      status: "todo",
      priority: "high",
      assignee: "agent",
      relatedContactId: id,
      relatedTemplateId: template?.id,
    });

    if (tactic.goal && (!contact.relationshipGoal || contact.relationshipGoalStatus === "not_started" || !contact.relationshipGoalStatus)) {
      updateContact(id, {
        relationshipGoal: tactic.goal,
        relationshipGoalStatus: "in_progress",
      });
    }

    let rtxResult = null;
    if (template) {
      const signalsBaseUrl = resolveSignalsBaseUrlFromRequest(req);
      rtxResult = await runTemplateViaRtx({
        templateId: template.id,
        config: {
          ...parseTemplateConfig(template.config),
          targetContactId: id,
          targetContactName: contact.name,
          relationshipGoal: tactic.goal,
          taskId: task.id,
        },
        systemPrompt: data.customPrompt || tactic.agentPrompt,
        signalsBaseUrl,
      });
    }

    return NextResponse.json(
      {
        success: true,
        taskId: task.id,
        task,
        tactic,
        threadName: CONTACT_RELATIONSHIP_NURTURE_TEMPLATE_NAME,
        workflowRunId: rtxResult?.workflowRunId ?? null,
        rtxDispatched: rtxResult?.success ?? false,
        threadPath: rtxResult && rtxResult.success ? rtxResult.threadPath : null,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten() },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
