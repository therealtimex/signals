import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";
import { getWorkflowRun, updateWorkflowRun } from "@/lib/db/queries/workflows";
import { getTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowRun } from "@/lib/db/types";

export type RunCohortSource = "explicit" | "stored" | "birth" | "config";

export type RunCohortErrorCode =
  | "RUN_NOT_FOUND"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_MISMATCH"
  | "UNKNOWN_CONTACTS";

export class RunCohortError extends Error {
  constructor(
    public readonly code: RunCohortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RunCohortError";
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeContactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unionCohort(
    value.map((item) => (typeof item === "string" ? item : "")),
  );
}

export function parseStoredCohort(result: string | null): string[] {
  return normalizeContactIds(parseJsonObject(result).createdContactIds);
}

export function unionCohort(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const cohort: string[] = [];
  for (const list of lists) {
    for (const rawId of list) {
      const id = rawId.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cohort.push(id);
    }
  }
  return cohort;
}

export function listBirthAttributedContactIds(runId: string): string[] {
  return db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.createdWorkflowRunId, runId))
    .orderBy(asc(contacts.createdAt), asc(contacts.id))
    .all()
    .map((contact) => contact.id);
}

export function resolveRunCohort(
  run: Pick<WorkflowRun, "id" | "result" | "config">,
  explicit?: string[],
): { contactIds: string[]; sources: RunCohortSource[] } {
  const explicitIds = unionCohort(explicit ?? []);
  const storedIds = parseStoredCohort(run.result);
  const birthIds = listBirthAttributedContactIds(run.id);
  const sources: RunCohortSource[] = [];

  if (explicitIds.length > 0) sources.push("explicit");
  if (storedIds.length > 0) sources.push("stored");
  if (birthIds.length > 0) sources.push("birth");

  const contactIds = unionCohort(explicitIds, storedIds, birthIds);
  if (contactIds.length > 0) {
    return { contactIds, sources };
  }

  const configIds = normalizeContactIds(parseJsonObject(run.config).targetContactIds);
  return {
    contactIds: configIds,
    sources: configIds.length > 0 ? ["config"] : [],
  };
}

export type RecordRunCohortResult = {
  runId: string;
  templateId: string | null;
  cohortSize: number;
  addedContactIds: string[];
  alreadyRecorded: number;
  processedItems: number;
};

export function recordRunCohort(input: {
  runId: string;
  templateId?: string;
  contactIds?: string[];
}): RecordRunCohortResult {
  const run = getWorkflowRun(input.runId);
  if (!run) {
    throw new RunCohortError("RUN_NOT_FOUND", `Workflow run ${input.runId} not found`);
  }

  if (input.templateId) {
    if (!getTemplate(input.templateId)) {
      throw new RunCohortError("TEMPLATE_NOT_FOUND", `Workflow template ${input.templateId} not found`);
    }
    if (run.templateId && run.templateId !== input.templateId) {
      throw new RunCohortError(
        "TEMPLATE_MISMATCH",
        `templateId ${input.templateId} does not match workflow run ${input.runId} (template ${run.templateId})`,
      );
    }
  }

  const requestedIds = unionCohort(input.contactIds ?? []);
  if (requestedIds.length > 0) {
    const existingIds = new Set(
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(inArray(contacts.id, requestedIds))
        .all()
        .map((contact) => contact.id),
    );
    const unknownIds = requestedIds.filter((id) => !existingIds.has(id));
    if (unknownIds.length > 0) {
      throw new RunCohortError(
        "UNKNOWN_CONTACTS",
        `Unknown contact IDs: ${unknownIds.join(", ")}`,
      );
    }
  }

  const storedIds = parseStoredCohort(run.result);
  const storedSet = new Set(storedIds);
  const addedContactIds = requestedIds.filter((id) => !storedSet.has(id));
  const cohort = unionCohort(storedIds, requestedIds);
  const alreadyRecorded = requestedIds.length - addedContactIds.length;

  if (addedContactIds.length === 0) {
    return {
      runId: run.id,
      templateId: input.templateId ?? run.templateId,
      cohortSize: cohort.length,
      addedContactIds,
      alreadyRecorded,
      processedItems: run.processedItems,
    };
  }

  const processedItems = Math.max(run.processedItems, cohort.length);
  const updated = updateWorkflowRun(run.id, {
    result: JSON.stringify({
      ...parseJsonObject(run.result),
      createdContactIds: cohort,
    }),
    processedItems,
  });

  return {
    runId: run.id,
    templateId: input.templateId ?? run.templateId,
    cohortSize: cohort.length,
    addedContactIds,
    alreadyRecorded,
    processedItems: updated?.processedItems ?? processedItems,
  };
}
