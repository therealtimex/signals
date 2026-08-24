import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workflowRuns, workflowTemplates, contacts, contactIdentities } from "@/lib/db/schema";
import {
  dispatchWorkflowCascade,
  readWorkflowCascadeConfig,
  type DispatchCascadeResult,
  type WorkflowCascadeConfig,
} from "@/lib/workflows/chaining";
import {
  DEFAULT_ORCHESTRATOR_THREAD_SLUG,
  SIGNALS_ORCHESTRATOR_THREAD_NAME,
  getOrCreateOrchestratorThread,
} from "@/lib/rtx/orchestrator-thread";
import {
  buildOrchestratorBriefMarkdown,
  writeOrchestratorBriefFile,
} from "@/lib/rtx/orchestrator-brief";
import {
  buildOrchestratorBriefRoutingMessage,
  orchestratorEventBriefRelativePath,
} from "@/lib/rtx/workspace-brief-files";
import { getSignalsRtxWorkspaceSlug } from "@/lib/rtx/cli-provisioning";
import { dispatchTerminalAgentViaSendMessage } from "@/lib/rtx/runtime-sessions";
import { getRtxRefsFromRunConfig } from "@/lib/agents/run-template-via-rtx";

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
  targetThread?: {
    name: string;
    slug?: string;
  };
}

export interface EmitWorkflowCompletedResult {
  emitted: boolean;
  event: WorkflowCompletedEventPayload;
  cascadeResult?: DispatchCascadeResult;
  routingRecommendation?: {
    suggestedAction: "nurture" | "patrol" | "profile_pipeline" | "review";
    rationale: string;
  };
  outboundDelivered?: boolean;
}

export interface OutboundWebhookHeaders {
  [header: string]: string;
}

/**
 * Builds standard signed webhook headers conforming to the RealTimeX Local Apps contract.
 */
export function buildSignedWebhookHeaders(
  rawBody: string,
  options?: {
    secret?: string;
    eventType?: string;
    source?: string;
    deliveryId?: string;
    timestamp?: string;
  }
): OutboundWebhookHeaders {
  const secret =
    options?.secret ??
    process.env.REALTIMEX_WEBHOOK_SECRET ??
    process.env.SIGNALS_WEBHOOK_SECRET;

  const signatureHeader =
    process.env.REALTIMEX_WEBHOOK_SIGNATURE_HEADER || "x-realtimex-signature";
  const signaturePrefix =
    process.env.REALTIMEX_WEBHOOK_SIGNATURE_PREFIX || "sha256=";
  const timestampHeader =
    process.env.REALTIMEX_WEBHOOK_TIMESTAMP_HEADER || "x-realtimex-timestamp";
  const deliveryIdHeader =
    process.env.REALTIMEX_WEBHOOK_DELIVERY_ID_HEADER || "x-realtimex-delivery-id";
  const eventTypeHeader =
    process.env.REALTIMEX_WEBHOOK_EVENT_TYPE_HEADER || "x-realtimex-event-type";
  const sourceHeader =
    process.env.REALTIMEX_WEBHOOK_SOURCE_HEADER || "x-realtimex-source";

  const timestamp = options?.timestamp || new Date().toISOString();
  const deliveryId = options?.deliveryId || crypto.randomUUID();
  const eventType = options?.eventType || process.env.REALTIMEX_WEBHOOK_EVENT_TYPE || "workflow.completed";
  const source = options?.source || process.env.REALTIMEX_WEBHOOK_SOURCE || "com.realtimex.signals";

  const headers: OutboundWebhookHeaders = {
    "Content-Type": "application/json",
    [timestampHeader]: timestamp,
    [deliveryIdHeader]: deliveryId,
    [eventTypeHeader]: eventType,
    [sourceHeader]: source,
  };

  if (secret) {
    const hmacHex = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    headers[signatureHeader] = `${signaturePrefix}${hmacHex}`;
  }

  return headers;
}

/**
 * Verifies an incoming HMAC signature against the raw body string.
 */
export function verifyHmacSignature(
  rawBody: string,
  providedSignature: string | null | undefined,
  secret: string
): boolean {
  if (!providedSignature || !secret) return false;
  const hmacHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const prefix = process.env.REALTIMEX_WEBHOOK_SIGNATURE_PREFIX || "sha256=";
  const expectedWithPrefix = `${prefix}${hmacHex}`;

  try {
    const candidateA = Buffer.from(hmacHex);
    const candidateB = Buffer.from(expectedWithPrefix);
    const provided = Buffer.from(providedSignature.trim());

    if (provided.length === candidateA.length && crypto.timingSafeEqual(candidateA, provided)) {
      return true;
    }
    if (provided.length === candidateB.length && crypto.timingSafeEqual(candidateB, provided)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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
      ...contactIdentityList.map((i) => `${i.headline || ""} ${i.bio || ""}`),
    ]
      .join(" ")
      .toLowerCase();

    const isInvestor =
      combinedText.includes("investor") ||
      combinedText.includes("partner") ||
      combinedText.includes("angel") ||
      combinedText.includes("venture") ||
      combinedText.includes("capital");

    if (isInvestor) {
      investorCount++;
    }

    const hasAvatar = contactIdentityList.some((i) => Boolean(i.avatarUrl));
    if (!hasAvatar) {
      missingAvatarOrPersona++;
    }
  }

  const total = rows.length;
  const investorRatio = total > 0 ? investorCount / total : 0;
  const unhydratedRatio = total > 0 ? missingAvatarOrPersona / total : 0;

  if (investorRatio >= 0.3) {
    return {
      suggestedAction: "nurture",
      rationale: `Detected ${investorCount} high-value investor node(s) (${Math.round(investorRatio * 100)}% of cohort). Prioritize warm follow + engagement sequence.`,
    };
  }

  if (unhydratedRatio >= 0.5) {
    return {
      suggestedAction: "profile_pipeline",
      rationale: `${missingAvatarOrPersona} contact(s) lack complete avatar or profile data. Run Contact Profile Pipeline first to enrich bios and synthesize AI personas.`,
    };
  }

  return {
    suggestedAction: "patrol",
    rationale: `Discovered active founder/operator cohort. Deploy Social Intent Patrol to monitor launch chatter and product activity.`,
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
    secret?: string;
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

  let createdContactIds = options?.createdContactIds ?? (rawConfig.targetContactIds as string[] | undefined) ?? [];
  if (createdContactIds.length === 0) {
    const attributed = db.select({ id: contacts.id }).from(contacts).where(eq(contacts.createdWorkflowRunId, runId)).all();
    if (attributed.length > 0) {
      createdContactIds = attributed.map((c) => c.id);
    }
  }

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
    targetThread: {
      name: SIGNALS_ORCHESTRATOR_THREAD_NAME,
      slug: process.env.SIGNALS_ORCHESTRATOR_THREAD_SLUG || DEFAULT_ORCHESTRATOR_THREAD_SLUG,
    },
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

  // 1. Generate and write the structured Markdown brief file (@orchestrator-events/<runId>/brief.md)
  const rtxRefs = getRtxRefsFromRunConfig(run.config);
  const workspaceSlug = rtxRefs.workspaceSlug || getSignalsRtxWorkspaceSlug();
  const briefMarkdown = buildOrchestratorBriefMarkdown({
    eventPayload,
    routingRecommendation,
  });

  await writeOrchestratorBriefFile(workspaceSlug, runId, briefMarkdown);

  // 2. If agentic_router is active, dispatch the file-based brief message to the Signals Orchestrator thread
  if (cascadeConfig.followOnActions.includes("agentic_router")) {
    try {
      const orchestratorThread = await getOrCreateOrchestratorThread(
        { workspaceSlug },
        process.env,
        options?.fetchImpl ?? fetch
      );
      const routingMessage = buildOrchestratorBriefRoutingMessage({
        runId,
        templateName: eventPayload.templateName,
        eventType: eventPayload.event,
        suggestedAction: routingRecommendation?.suggestedAction,
      });

      await dispatchTerminalAgentViaSendMessage(
        {
          workspaceSlug: orchestratorThread.workspaceSlug,
          threadSlug: orchestratorThread.threadSlug,
          message: routingMessage,
          reason: `Orchestrator handoff for run ${runId}`,
        },
        process.env,
        options?.fetchImpl ?? fetch
      );
    } catch {
      // Non-blocking thread dispatch
    }
  }

  // Outbound Webhook dispatch (RealTimeX Webhook Ingress, n8n, Zapier, custom URL)
  const defaultRtxWebhookUrl = "http://127.0.0.1:3001/api/v1/webhook-ingress/inbound/signals-orchestrator";
  const targetWebhookUrl =
    options?.webhookUrl ??
    process.env.REALTIMEX_WEBHOOK_URL ??
    process.env.SIGNALS_WEBHOOK_URL ??
    defaultRtxWebhookUrl;

  const targetSecret =
    options?.secret ??
    process.env.REALTIMEX_WEBHOOK_SECRET ??
    process.env.SIGNALS_WEBHOOK_SECRET ??
    "signals_secret_rtx_2026";

  let outboundDelivered = false;
  if (targetWebhookUrl) {
    try {
      const fetcher = options?.fetchImpl ?? fetch;
      const rawBody = JSON.stringify({
        ...eventPayload,
        routingRecommendation,
      });

      const headers = buildSignedWebhookHeaders(rawBody, {
        secret: targetSecret,
        eventType: "workflow.completed",
        source: "com.realtimex.signals",
      });

      await fetcher(targetWebhookUrl, {
        method: "POST",
        headers,
        body: rawBody,
      });
      outboundDelivered = true;
    } catch {
      // Non-blocking outbound delivery
    }
  }

  return {
    emitted: true,
    event: eventPayload,
    cascadeResult,
    routingRecommendation,
    outboundDelivered,
  };
}
