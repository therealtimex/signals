import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowTemplates, contacts, contactIdentities } from "@/lib/db/schema";
import {
  dispatchWorkflowCascade,
  readWorkflowCascadeConfig,
  type DispatchCascadeResult,
  type WorkflowCascadeConfig,
} from "@/lib/workflows/chaining";

export interface WorkflowCompletedEventPayload {
  event: "workflow.completed";
  runId: string;
  templateId?: string;
  templateName?: string;
  templateType?: string;
  status: "completed" | "failed";
  createdContactIds?: string[];
  totalProcessed?: number;
  summary?: string;
  timestamp: number;
  cascadeConfig?: WorkflowCascadeConfig;
}

export interface EmitWorkflowCompletedResult {
  emitted: boolean;
  event: WorkflowCompletedEventPayload;
  cascadeResult?: DispatchCascadeResult;
  routingRecommendation?: {
    suggestedAction: "nurture" | "patrol" | "profile_pipeline" | "review";
    rationale: string;
  };
}

/**
 * Generates an agentic routing recommendation by analyzing the cohort output.
 */
export function evaluateAgenticRouting(createdContactIds: string[]): {
  suggestedAction: "nurture" | "patrol" | "profile_pipeline" | "review";
  rationale: string;
} {
  if (createdContactIds.length === 0) {
    return {
      suggestedAction: "review",
      rationale: "No contacts were created or discovered in this run.",
    };
  }

  const contactIdSet = new Set(createdContactIds);
  const rows = db
    .select()
    .from(contacts)
    .all()
    .filter((c) => contactIdSet.has(c.id));

  const identities = createdContactIds.length > 0
    ? db.select().from(contactIdentities).all().filter((ci) => contactIdSet.has(ci.contactId))
    : [];

  let investorCount = 0;
  let missingAvatarOrPersona = 0;

  for (const contact of rows) {
    const contactIdentityList = identities.filter((ci) => ci.contactId === contact.id);
    const combinedText = [
      contact.name,
      contact.tags,
      contact.metadata,
      ...contactIdentityList.flatMap((ci) => [ci.headline, ci.bio, ci.displayName]),
    ]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ")
      .toLowerCase();

    if (
      combinedText.includes("investor") ||
      combinedText.includes("partner") ||
      combinedText.includes("angel") ||
      combinedText.includes("general partner") ||
      combinedText.includes("lead investor") ||
      combinedText.includes("vc") ||
      combinedText.includes("venture")
    ) {
      investorCount++;
    }

    const hasAvatar = Boolean(contactIdentityList.some((ci) => Boolean(ci.avatarUrl)));
    const hasPersona = Boolean(contact.metadata && contact.metadata.includes("persona"));
    if (!hasAvatar && !hasPersona) {
      missingAvatarOrPersona++;
    }
  }

  if (investorCount > 0 && investorCount >= rows.length * 0.3) {
    return {
      suggestedAction: "nurture",
      rationale: `Detected ${investorCount} high-value investor node(s). Prioritize warm follow + engagement sequence.`,
    };
  }

  if (missingAvatarOrPersona > rows.length * 0.5) {
    return {
      suggestedAction: "profile_pipeline",
      rationale: `${missingAvatarOrPersona} contact(s) lack rich persona/avatar data. Run Contact Profile Pipeline first.`,
    };
  }

  return {
    suggestedAction: "patrol",
    rationale: `Active ecosystem cohort detected (${rows.length} contacts). Monitor ongoing launch and technical intent.`,
  };
}

/**
 * Core event emitter for workflow completion. Dispatches deterministic cascade or agentic routing.
 */
export async function emitWorkflowCompletedEvent(
  runId: string,
  options?: {
    summary?: string;
    createdContactIds?: string[];
    webhookUrl?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<EmitWorkflowCompletedResult> {
  const run = db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).get();
  if (!run) {
    throw new Error(`Workflow run ${runId} not found`);
  }

  const template = run.templateId
    ? db.select().from(workflowTemplates).where(eq(workflowTemplates.id, run.templateId)).get()
    : null;

  const rawConfig = JSON.parse(run.config ?? "{}") as Record<string, unknown>;
  const cascadeConfig = readWorkflowCascadeConfig(rawConfig);

  const createdContactIds = options?.createdContactIds ?? (rawConfig.targetContactIds as string[] | undefined) ?? [];

  const eventPayload: WorkflowCompletedEventPayload = {
    event: "workflow.completed",
    runId,
    templateId: template?.id,
    templateName: template?.name ?? "Unknown Workflow",
    templateType: run.workflowType,
    status: run.status === "failed" ? "failed" : "completed",
    createdContactIds,
    totalProcessed: run.processedItems ?? createdContactIds.length,
    summary: options?.summary ?? `Completed workflow run ${runId}`,
    timestamp: Math.floor(Date.now() / 1000),
    cascadeConfig,
  };

  let cascadeResult: DispatchCascadeResult | undefined;
  let routingRecommendation: { suggestedAction: "nurture" | "patrol" | "profile_pipeline" | "review"; rationale: string } | undefined;

  if (cascadeConfig.followOnActions.includes("agentic_router")) {
    routingRecommendation = evaluateAgenticRouting(createdContactIds);
    cascadeResult = {
      triggered: true,
      followOnActions: cascadeConfig.followOnActions,
      followOnAction: "agentic_router",
      reason: routingRecommendation.rationale,
    };
  } else if (cascadeConfig.followOnActions.length > 0 && cascadeConfig.cascadePolicy === "immediate") {
    cascadeResult = dispatchWorkflowCascade({
      parentRunId: runId,
      createdContactIds,
      overrideActions: cascadeConfig.followOnActions,
    });
  }

  // Outbound Webhook dispatch (RealTimeX, n8n, Zapier, custom URL)
  const targetWebhookUrl =
    options?.webhookUrl ??
    process.env.SIGNALS_WEBHOOK_URL ??
    process.env.REALTIMEX_WEBHOOK_URL;

  if (targetWebhookUrl) {
    try {
      const fetcher = options?.fetchImpl ?? fetch;
      await fetcher(targetWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...eventPayload,
          routingRecommendation,
        }),
      });
    } catch {
      // Non-blocking outbound delivery
    }
  }

  return {
    emitted: true,
    event: eventPayload,
    cascadeResult,
    routingRecommendation,
  };
}
