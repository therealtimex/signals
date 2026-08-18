import {
  assertCreationTag,
  BIRTH_FIELD_KEYS,
  createdSourceFromTag,
  type CreationTag,
} from "@/lib/db/creation-sources";
import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { getTemplate } from "@/lib/db/queries/workflow-templates";

export type CreationProvenance = {
  tag: CreationTag;
  workflowRunId?: string | null;
  templateId?: string | null;
};

export function normalizeCreationProvenance(
  provenance: CreationTag | CreationProvenance,
): CreationProvenance {
  if (typeof provenance === "string") {
    assertCreationTag(provenance);
    return { tag: provenance, workflowRunId: null, templateId: null };
  }

  assertCreationTag(provenance.tag);
  return {
    tag: provenance.tag,
    workflowRunId: provenance.workflowRunId ?? null,
    templateId: provenance.templateId ?? null,
  };
}

export function birthFieldsFromProvenance(provenance: CreationProvenance) {
  return {
    createdSource: createdSourceFromTag(provenance.tag),
    createdSourceDetail: provenance.tag,
    createdWorkflowRunId: provenance.workflowRunId ?? null,
    createdTemplateId: provenance.templateId ?? null,
  };
}

export function validateWorkflowRunAndTemplateIds(opts: {
  workflowRunId?: string | null;
  templateId?: string | null;
}): { workflowRunId: string | null; templateId: string | null } {
  let workflowRunId = opts.workflowRunId ?? null;
  let templateId = opts.templateId ?? null;

  if (workflowRunId) {
    const run = getWorkflowRun(workflowRunId);
    if (!run) {
      throw new Error(`Unknown workflowRunId: ${workflowRunId}`);
    }
    if (!templateId && run.templateId) {
      templateId = run.templateId;
    }
  }

  if (templateId) {
    const template = getTemplate(templateId);
    if (!template) {
      throw new Error(`Unknown templateId: ${templateId}`);
    }
  }

  return { workflowRunId, templateId };
}

export const IMMUTABLE_BIRTH_FIELDS_MESSAGE = "creation provenance is immutable";

export function getImmutableBirthFieldsError(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  for (const key of BIRTH_FIELD_KEYS) {
    if (key in body) {
      return IMMUTABLE_BIRTH_FIELDS_MESSAGE;
    }
  }

  return null;
}
