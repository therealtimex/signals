/**
 * Server-side authority for composed writing.
 *
 * Whether a variant is an `assist_only` proposal is **not** the caller's claim to make. The agent
 * submits `metadata.writing.intent`, but the decision to *require* one — and with it explicit
 * approval, a compatible target, and the send block — is derived here from the workflow run row
 * Signals itself wrote at dispatch time (`buildStoredRunConfig`), falling back to the template
 * config.
 *
 * Two directions, both fail-closed:
 * - A run whose stored config carries the opt-in **must** produce a valid, matching intent.
 * - A run that does not **must not** carry one, so assist-only provenance cannot be forged onto an
 *   unrelated artifact.
 */

import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { DbRunner } from "@/lib/db/client";
import { workflowRuns, workflowTemplates } from "@/lib/db/schema";
import type { SurfaceId } from "@/lib/writing/surfaces";
import {
  readWritingIntentComposition,
  readWritingIntentRecord,
  type WritingIntentComposition,
  type WritingIntentRecord,
} from "@/lib/writing/writing-intent";

export type ComposedRunAuthority = {
  workflowRunId: string;
  templateId: string | null;
  composition: WritingIntentComposition;
};

export type WritingIntentAuthorityReason =
  | "writing_intent_required"
  | "writing_intent_not_permitted"
  | "writing_intent_invalid"
  | "writing_intent_consumer_mismatch"
  | "writing_intent_surface_mismatch"
  | "writing_intent_surface_not_allowed"
  | "writing_intent_lineage_mismatch";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fail(reason: WritingIntentAuthorityReason, message: string): never {
  throw new AgentToolError("VALIDATION_ERROR", message, {
    reason,
    path: ["metadata", "writing", "intent"],
  });
}

/**
 * Resolve the composition a workflow run was dispatched under.
 *
 * Returns `null` for an unknown run id as well as an uncomposed one: an intent claiming a run that
 * does not exist is rejected by `assertWritingIntentAuthority`, which is the safe direction.
 */
export function resolveComposedRunAuthority(
  runner: DbRunner,
  workflowRunId: string,
): ComposedRunAuthority | null {
  const run = runner.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRunId)).get();
  if (!run) return null;
  const fromRun = readWritingIntentComposition(object(run.config));
  if (fromRun) {
    return { workflowRunId: run.id, templateId: run.templateId ?? null, composition: fromRun };
  }
  if (!run.templateId) return null;
  const template = runner
    .select()
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, run.templateId))
    .get();
  const fromTemplate = template ? readWritingIntentComposition(object(template.config)) : null;
  return fromTemplate
    ? { workflowRunId: run.id, templateId: run.templateId, composition: fromTemplate }
    : null;
}

/**
 * Reconcile a submitted intent against the run's server-resolved composition.
 *
 * Returns the validated record when the run is composed, `null` when it is not. Throws rather than
 * downgrading: a mismatch means the agent and the dispatch record disagree about what this artifact
 * is, and guessing either way loses the mandate.
 */
export function assertWritingIntentAuthority(input: {
  authority: ComposedRunAuthority | null;
  intent: unknown;
  surface: SurfaceId;
  workflowRunId: string;
}): WritingIntentRecord | null {
  const submitted = input.intent;
  if (!input.authority) {
    if (submitted === undefined || submitted === null) return null;
    return fail(
      "writing_intent_not_permitted",
      "This workflow run is not composed for writing intents",
    );
  }
  const { composition, templateId } = input.authority;
  if (submitted === undefined || submitted === null) {
    return fail(
      "writing_intent_required",
      `Workflow run ${input.workflowRunId} is composed as ${composition.consumer} and requires metadata.writing.intent`,
    );
  }
  const record = readWritingIntentRecord(submitted);
  if (!record) return fail("writing_intent_invalid", "Invalid writing intent record");
  if (record.consumer !== composition.consumer) {
    return fail(
      "writing_intent_consumer_mismatch",
      `Writing intent consumer ${record.consumer} does not match the run's ${composition.consumer}`,
    );
  }
  if (record.surface !== input.surface) {
    return fail(
      "writing_intent_surface_mismatch",
      "Writing intent surface does not match the variant surface",
    );
  }
  if (!composition.surfaces.includes(record.surface)) {
    return fail(
      "writing_intent_surface_not_allowed",
      `Surface ${record.surface} is not enabled for this workflow`,
    );
  }
  if (record.lineage.workflowRunId !== input.workflowRunId) {
    return fail(
      "writing_intent_lineage_mismatch",
      "Writing intent lineage names a different workflow run",
    );
  }
  if (templateId && record.lineage.templateId !== templateId) {
    return fail(
      "writing_intent_lineage_mismatch",
      "Writing intent lineage names a different template",
    );
  }
  return record;
}
