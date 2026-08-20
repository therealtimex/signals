import { eq, and, asc, count, desc, isNull, SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import {
  workflowTemplates,
  workflowTemplateSteps,
  workflowEnrollments,
  contacts,
} from "@/lib/db/schema";
import { resolveContactPrimaryEmail } from "@/lib/db/queries/contact-dto";
import type {
  WorkflowTemplate,
  NewWorkflowTemplate,
  WorkflowTemplateStep,
  NewWorkflowTemplateStep,
  WorkflowEnrollment,
  NewWorkflowEnrollment,
  PaginatedResult,
} from "@/lib/db/types";

// ── Templates ──────────────────────────────────

export function createTemplate(
  data: Omit<NewWorkflowTemplate, "id">
): WorkflowTemplate {
  const id = nanoid();
  db.insert(workflowTemplates).values({ ...data, id }).run();
  return db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get()!;
}

export function updateTemplate(
  id: string,
  data: Partial<
    Pick<
      WorkflowTemplate,
      | "name" | "description" | "platform" | "templateType" | "status"
      | "config" | "goalMetrics" | "startsAt" | "endsAt"
      | "systemPrompt" | "targetPersona" | "estimatedCost" | "totalRuns" | "lastRunAt"
    >
  >
): WorkflowTemplate | undefined {
  const existing = db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get();
  if (!existing) return undefined;

  db.update(workflowTemplates)
    .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(workflowTemplates.id, id))
    .run();

  return db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get();
}

/**
 * Compare-and-swap the template's dedicated RTX thread pointer.
 *
 * Two runs of one template can race to provision the first thread (a scheduled drain
 * overlapping a manual run). The conditional write makes one of them the winner and
 * returns the pointer that actually stuck, so the loser dispatches into the same
 * thread instead of forking the timeline.
 */
export function claimTemplateThreadSlug(
  id: string,
  expected: string | null,
  next: string
): string {
  db.update(workflowTemplates)
    .set({ rtxThreadSlug: next, updatedAt: Math.floor(Date.now() / 1000) })
    .where(
      and(
        eq(workflowTemplates.id, id),
        expected === null
          ? isNull(workflowTemplates.rtxThreadSlug)
          : eq(workflowTemplates.rtxThreadSlug, expected)
      )
    )
    .run();

  const current = db
    .select({ rtxThreadSlug: workflowTemplates.rtxThreadSlug })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get();

  return current?.rtxThreadSlug ?? next;
}

export type WorkflowTemplateWithSteps = WorkflowTemplate & {
  steps: WorkflowTemplateStep[];
  enrollmentCount: number;
};

export function getSystemTemplateByName(name: string): WorkflowTemplate | undefined {
  return db
    .select()
    .from(workflowTemplates)
    .where(and(eq(workflowTemplates.name, name), eq(workflowTemplates.isSystem, 1)))
    .get();
}

export function getTemplate(
  id: string
): WorkflowTemplateWithSteps | undefined {
  const template = db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get();
  if (!template) return undefined;

  const steps = db
    .select()
    .from(workflowTemplateSteps)
    .where(eq(workflowTemplateSteps.templateId, id))
    .orderBy(asc(workflowTemplateSteps.stepIndex))
    .all();

  const enrollmentCount =
    db
      .select({ value: count() })
      .from(workflowEnrollments)
      .where(eq(workflowEnrollments.templateId, id))
      .get()?.value ?? 0;

  return { ...template, steps, enrollmentCount };
}

export function listTemplates(opts?: {
  status?: WorkflowTemplate["status"];
  templateType?: WorkflowTemplate["templateType"];
  isSystem?: boolean;
  page?: number;
  pageSize?: number;
}): PaginatedResult<WorkflowTemplate> {
  const conditions: SQL[] = [];

  if (opts?.status) {
    conditions.push(
      eq(
        workflowTemplates.status,
        opts.status as "draft" | "active" | "paused" | "completed"
      )
    );
  }
  if (opts?.templateType) {
    conditions.push(
      eq(
        workflowTemplates.templateType,
        opts.templateType as "outreach" | "engagement" | "content" | "nurture" | "prospecting" | "enrichment" | "pruning"
      )
    );
  }
  if (opts?.isSystem !== undefined) {
    conditions.push(eq(workflowTemplates.isSystem, opts.isSystem ? 1 : 0));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const total =
    db
      .select({ value: count() })
      .from(workflowTemplates)
      .where(whereClause)
      .get()?.value ?? 0;

  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const data = db
    .select()
    .from(workflowTemplates)
    .where(whereClause)
    .orderBy(desc(workflowTemplates.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  return { data, total };
}

/**
 * Clone a template, creating a new user template from a source.
 */
export function cloneTemplate(
  sourceId: string,
  overrides?: Partial<{
    name: string;
    description: string;
    systemPrompt: string;
    targetPersona: string;
    config: string;
  }>
): WorkflowTemplate | undefined {
  const source = db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, sourceId))
    .get();
  if (!source) return undefined;

  return createTemplate({
    name: overrides?.name ?? `${source.name} (Copy)`,
    description: overrides?.description ?? source.description,
    platform: source.platform,
    templateType: source.templateType,
    status: "active",
    config: overrides?.config ?? source.config,
    goalMetrics: source.goalMetrics,
    systemPrompt: overrides?.systemPrompt ?? source.systemPrompt,
    targetPersona: overrides?.targetPersona ?? source.targetPersona,
    estimatedCost: source.estimatedCost,
    totalRuns: 0,
    isSystem: 0,
    sourceTemplateId: sourceId,
  });
}

export function deleteTemplate(id: string): boolean {
  const existing = db
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .get();
  if (!existing) return false;

  // Prevent deletion of system templates
  if (existing.isSystem === 1) return false;

  // Cascade deletes steps + enrollments via FK onDelete
  db.delete(workflowTemplates)
    .where(eq(workflowTemplates.id, id))
    .run();
  return true;
}

// ── Template Steps ─────────────────────────────

export function addTemplateStep(
  data: Omit<NewWorkflowTemplateStep, "id">
): WorkflowTemplateStep {
  const id = nanoid();
  db.insert(workflowTemplateSteps).values({ ...data, id }).run();
  return db
    .select()
    .from(workflowTemplateSteps)
    .where(eq(workflowTemplateSteps.id, id))
    .get()!;
}

// ── Enrollments ────────────────────────────────

export function enrollContact(
  data: Omit<NewWorkflowEnrollment, "id">
): WorkflowEnrollment {
  const id = nanoid();
  db.insert(workflowEnrollments).values({ ...data, id }).run();
  return db
    .select()
    .from(workflowEnrollments)
    .where(eq(workflowEnrollments.id, id))
    .get()!;
}

export type EnrollmentWithContact = WorkflowEnrollment & {
  contactName: string;
  contactEmail: string | null;
};

export function listEnrollments(
  templateId: string
): EnrollmentWithContact[] {
  const rows = db
    .select({
      enrollment: workflowEnrollments,
      contactName: contacts.name,
    })
    .from(workflowEnrollments)
    .innerJoin(contacts, eq(workflowEnrollments.contactId, contacts.id))
    .where(eq(workflowEnrollments.templateId, templateId))
    .orderBy(desc(workflowEnrollments.enrolledAt))
    .all();

  return rows.map((r) => ({
    ...r.enrollment,
    contactName: r.contactName,
    contactEmail: resolveContactPrimaryEmail(r.enrollment.contactId),
  }));
}
