import { count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts, workflowTemplates } from "@/lib/db/schema";

export type ContactProvenanceTemplateOption = {
  id: string;
  name: string;
  contactCount: number;
};

export type ContactProvenanceWorkflowRunOption = {
  id: string;
  contactCount: number;
  latestCreatedAt: number;
  templateName: string | null;
};

export function listContactProvenanceTemplates(limit = 40): ContactProvenanceTemplateOption[] {
  const rows = db
    .select({
      id: contacts.createdTemplateId,
      name: workflowTemplates.name,
      contactCount: count(),
    })
    .from(contacts)
    .innerJoin(workflowTemplates, eq(contacts.createdTemplateId, workflowTemplates.id))
    .where(isNotNull(contacts.createdTemplateId))
    .groupBy(contacts.createdTemplateId, workflowTemplates.name)
    .orderBy(desc(count()))
    .limit(limit)
    .all();

  return rows
    .filter((row) => row.id)
    .map((row) => ({
      id: row.id!,
      name: row.name,
      contactCount: row.contactCount,
    }));
}

export function listContactProvenanceWorkflowRuns(limit = 30): ContactProvenanceWorkflowRunOption[] {
  const rows = db
    .select({
      id: contacts.createdWorkflowRunId,
      contactCount: count(),
      latestCreatedAt: sql<number>`max(${contacts.createdAt})`,
      templateName: sql<string | null>`max(${workflowTemplates.name})`,
    })
    .from(contacts)
    .leftJoin(workflowTemplates, eq(contacts.createdTemplateId, workflowTemplates.id))
    .where(isNotNull(contacts.createdWorkflowRunId))
    .groupBy(contacts.createdWorkflowRunId)
    .orderBy(desc(sql`max(${contacts.createdAt})`))
    .limit(limit)
    .all();

  return rows
    .filter((row) => row.id)
    .map((row) => ({
      id: row.id!,
      contactCount: row.contactCount,
      latestCreatedAt: row.latestCreatedAt,
      templateName: row.templateName ?? null,
    }));
}
