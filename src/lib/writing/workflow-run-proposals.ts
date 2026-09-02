import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { launches, variants } from "@/lib/db/schema";
import type { Variant } from "@/lib/db/types";
import { getContactsByIds } from "@/lib/db/queries/contacts";
import { listVariantsByLaunchId, isWritingVariant } from "@/lib/db/queries/variants";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import type { Platform } from "@/lib/db/platforms";
import type { RelationshipGoal } from "@/lib/relationship-goals";
import type { PublishCapability } from "@/lib/writing/capabilities";
import {
  launchCompositionSchema,
  variantWritingSchema,
  type ApprovalState,
} from "@/lib/writing/contracts";
import { contentTypeForSurface, type SurfaceId } from "@/lib/writing/surfaces";
import { isWritingComposedConfig } from "@/lib/writing/writing-intent";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export interface WorkflowRunProposalSummary {
  total: number;
  pendingReview: number;
  approved: number;
  materialized: number;
  rejected: number;
  blocked: number;
  revoked: number;
}

export interface ValidWorkflowRunProposal {
  valid: true;
  variantId: string;
  launchId: string;
  launchName: string;
  platform: Platform;
  surface: SurfaceId;
  contentType: "reply" | "dm" | "post" | "thread";
  recipient: {
    contactId: string;
    handle: string | null;
    name: string | null;
    href: string;
  } | null;
  goal: { relationshipGoal: RelationshipGoal; writingGoal: string } | null;
  body: string;
  audit: {
    verdict: "pass" | "warn" | "block";
    findings: Array<{ code: string; severity: "blocker" | "warning" | "info"; message: string }>;
  } | null;
  approval: ApprovalState & { evidenceKind?: "thread_message" | "ui" | "api" };
  capability: { publish: PublishCapability };
  mandate: "assist_only" | null;
  materializedContentItemId: string | null;
  revisionRequest: { requestedAt: number; note: string; evidenceKind: "ui" } | null;
  variantStatus: Variant["status"];
  href: string;
}

export interface InvalidWorkflowRunProposal {
  valid: false;
  variantId: string;
  launchId: string;
  launchName: string;
  variantStatus: Variant["status"];
  body: string;
  href: string;
  invalidReason: string;
}

export type WorkflowRunProposal = ValidWorkflowRunProposal | InvalidWorkflowRunProposal;

export interface WorkflowRunProposals {
  launches: Array<{ id: string; name: string; href: string }>;
  proposals: WorkflowRunProposal[];
  summary: WorkflowRunProposalSummary;
}

function emptySummary(): WorkflowRunProposalSummary {
  return {
    total: 0,
    pendingReview: 0,
    approved: 0,
    materialized: 0,
    rejected: 0,
    blocked: 0,
    revoked: 0,
  };
}

function invalidReason(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "writing"}: ${issue.message}`)
    .join("; ");
}

export function listWorkflowRunProposals(workflowRunId: string): WorkflowRunProposals {
  const launchRows = db.select().from(launches).where(sql`
    json_extract(${launches.metadata}, '$.writing.composition.workflowRunId') = ${workflowRunId}
  `).all();
  const launchDtos = launchRows.map((launch) => ({
    id: launch.id,
    name: launch.name,
    href: `/dashboard/launches/${launch.id}`,
  }));
  const rows = launchRows.flatMap((launch) => listVariantsByLaunchId(launch.id)
    .filter(isWritingVariant)
    .map((variant) => ({ launch, variant })));

  const parsedRows = rows.map(({ launch, variant }) => ({
    launch,
    variant,
    parsed: variantWritingSchema.safeParse(object(variant.metadata).writing),
    composition: launchCompositionSchema.safeParse(
      object(object(launch.metadata).writing).composition,
    ),
  }));
  const contactIds = [...new Set(parsedRows.flatMap(({ parsed }) =>
    parsed.success && parsed.data.intent?.recipient?.contactId
      ? [parsed.data.intent.recipient.contactId]
      : [],
  ))];
  const contacts = new Map(getContactsByIds(contactIds).map((contact) => [contact.id, contact]));

  const proposals: WorkflowRunProposal[] = parsedRows.map(({ launch, variant, parsed, composition }) => {
    const href = `/dashboard/launches/${launch.id}/variants/${variant.id}`;
    if (!parsed.success) {
      return {
        valid: false,
        variantId: variant.id,
        launchId: launch.id,
        launchName: launch.name,
        variantStatus: variant.status,
        body: variant.body ?? "",
        href,
        invalidReason: invalidReason(parsed.error.issues),
      };
    }
    const writing = parsed.data;
    const recipientRef = writing.intent?.recipient ?? null;
    const contact = recipientRef ? contacts.get(recipientRef.contactId) : undefined;
    const identity = contact?.identities.find((entry) => entry.platform === recipientRef?.platform)
      ?? contact?.identities[0];
    return {
      valid: true,
      variantId: variant.id,
      launchId: launch.id,
      launchName: launch.name,
      platform: writing.platform,
      surface: writing.surface,
      contentType: contentTypeForSurface(writing.surface),
      recipient: recipientRef
        ? {
            contactId: recipientRef.contactId,
            handle: recipientRef.handle ?? identity?.platformHandle ?? null,
            name: contact?.name ?? null,
            href: `/dashboard/contacts/${recipientRef.contactId}`,
          }
        : null,
      goal: writing.intent?.goal
        ? {
            relationshipGoal: writing.intent.goal.id,
            writingGoal: writing.intent.goal.writingGoal,
          }
        : null,
      body: writing.units.texts.join("\n\n"),
      audit: writing.audit
        ? {
            verdict: writing.audit.verdict,
            findings: writing.audit.findings.map(({ code, severity, message }) => ({
              code,
              severity,
              message,
            })),
          }
        : null,
      approval: {
        ...writing.approval,
        ...(writing.approval.evidence
          ? { evidenceKind: writing.approval.evidence.kind }
          : {}),
      },
      capability: writing.capability,
      mandate: composition.success ? composition.data.mandate : null,
      materializedContentItemId: writing.materializedContentItemId ?? null,
      revisionRequest: writing.revisionRequest
        ? {
            requestedAt: writing.revisionRequest.requestedAt,
            note: writing.revisionRequest.note,
            evidenceKind: writing.revisionRequest.evidence.kind,
          }
        : null,
      variantStatus: variant.status,
      href,
    };
  });

  const summary = proposals.reduce((result, proposal) => {
    result.total += 1;
    if (!proposal.valid) {
      result.blocked += 1;
      return result;
    }
    const rejected = proposal.variantStatus === "rejected" || proposal.approval.state === "rejected";
    const blocked = proposal.audit?.verdict === "block";
    const materialized = Boolean(proposal.materializedContentItemId);
    if (rejected) result.rejected += 1;
    if (blocked) result.blocked += 1;
    if (materialized) result.materialized += 1;
    if (proposal.approval.state === "approved" && !materialized) result.approved += 1;
    if (proposal.approval.state === "revoked") result.revoked += 1;
    if (
      !rejected
      && !blocked
      && (proposal.approval.state === "pending" || proposal.approval.state === "revoked")
    ) {
      result.pendingReview += 1;
    }
    return result;
  }, emptySummary());

  return { launches: launchDtos, proposals, summary };
}

export function summarizeWorkflowRunProposals(
  workflowRunId: string,
): WorkflowRunProposalSummary | null {
  const run = getWorkflowRun(workflowRunId);
  if (!run || !isWritingComposedConfig(object(run.config))) return null;
  return listWorkflowRunProposals(workflowRunId).summary;
}

export function getWorkflowRunProposal(
  workflowRunId: string,
  variantId: string,
): WorkflowRunProposal | null {
  return listWorkflowRunProposals(workflowRunId).proposals.find(
    (proposal) => proposal.variantId === variantId,
  ) ?? null;
}

export function findWorkflowRunIdForProposal(variantId: string): string | null {
  const variant = db.select({ launchId: variants.launchId }).from(variants)
    .where(eq(variants.id, variantId)).get();
  if (!variant) return null;
  const launch = db.select({ metadata: launches.metadata }).from(launches)
    .where(eq(launches.id, variant.launchId)).get();
  const parsed = launchCompositionSchema.safeParse(
    object(object(launch?.metadata).writing).composition,
  );
  return parsed.success ? parsed.data.workflowRunId : null;
}
