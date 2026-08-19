import { getContactsByIds } from "@/lib/db/queries/contacts";
import { getOrgById } from "@/lib/db/queries/orgs";
import { parseTemplateConfig } from "@/lib/workflows/template-config";
import type { WorkflowRun, WorkflowStep } from "@/lib/db/types";
import type { WorkflowRunSubject } from "@/lib/workflows/workflow-run-subjects-shared";

export type {
  WorkflowRunSubject,
  WorkflowRunSubjectKind,
} from "@/lib/workflows/workflow-run-subjects-shared";

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((entry) => (typeof entry === "string" ? entry : null)));
}

export function extractWorkflowRunSubjectIds(
  run: WorkflowRun,
  steps: WorkflowStep[] = [],
): {
  contactIds: string[];
  orgIds: string[];
} {
  const config = parseTemplateConfig(run.config);
  return {
    contactIds: uniqueStrings([
      typeof config.contactId === "string" ? config.contactId : null,
      ...readStringArray(config.contactIds),
      ...readStringArray(config.selectedContactIds),
      ...steps.map((step) => step.contactId),
    ]),
    orgIds: uniqueStrings([
      typeof config.orgId === "string" ? config.orgId : null,
      typeof config.organizationId === "string" ? config.organizationId : null,
    ]),
  };
}

function buildSubjectsForIds(ids: {
  contactIds: string[];
  orgIds: string[];
}): WorkflowRunSubject[] {
  const contactLabels = new Map(
    getContactsByIds(ids.contactIds).map((contact) => [
      contact.id,
      contact.name?.trim() || "Contact",
    ]),
  );
  const orgLabels = new Map<string, string>();
  for (const orgId of ids.orgIds) {
    const org = getOrgById(orgId);
    orgLabels.set(orgId, org?.name?.trim() || "Organization");
  }

  return [
    ...ids.contactIds.map((id) => ({
      kind: "contact" as const,
      id,
      label: contactLabels.get(id) ?? "Contact",
      href: `/dashboard/contacts/${id}`,
    })),
    ...ids.orgIds.map((id) => ({
      kind: "organization" as const,
      id,
      label: orgLabels.get(id) ?? "Organization",
      href: `/dashboard/organizations/${id}`,
    })),
  ];
}

export function resolveWorkflowRunSubjectsForDetail(
  run: WorkflowRun,
  steps: WorkflowStep[] = [],
): WorkflowRunSubject[] {
  return buildSubjectsForIds(extractWorkflowRunSubjectIds(run, steps));
}

export function resolveWorkflowRunSubjects(
  runs: WorkflowRun[],
): Record<string, WorkflowRunSubject[]> {
  const perRunIds = new Map<string, { contactIds: string[]; orgIds: string[] }>();
  const allContactIds = new Set<string>();
  const allOrgIds = new Set<string>();

  for (const run of runs) {
    const ids = extractWorkflowRunSubjectIds(run);
    perRunIds.set(run.id, ids);
    for (const contactId of ids.contactIds) allContactIds.add(contactId);
    for (const orgId of ids.orgIds) allOrgIds.add(orgId);
  }

  const contactLabels = new Map(
    getContactsByIds([...allContactIds]).map((contact) => [
      contact.id,
      contact.name?.trim() || "Contact",
    ]),
  );
  const orgLabels = new Map<string, string>();
  for (const orgId of allOrgIds) {
    const org = getOrgById(orgId);
    orgLabels.set(orgId, org?.name?.trim() || "Organization");
  }

  const subjectsByRunId: Record<string, WorkflowRunSubject[]> = {};
  for (const run of runs) {
    const ids = perRunIds.get(run.id);
    if (!ids) {
      subjectsByRunId[run.id] = [];
      continue;
    }

    subjectsByRunId[run.id] = [
      ...ids.contactIds.map((id) => ({
        kind: "contact" as const,
        id,
        label: contactLabels.get(id) ?? "Contact",
        href: `/dashboard/contacts/${id}`,
      })),
      ...ids.orgIds.map((id) => ({
        kind: "organization" as const,
        id,
        label: orgLabels.get(id) ?? "Organization",
        href: `/dashboard/organizations/${id}`,
      })),
    ];
  }

  return subjectsByRunId;
}
