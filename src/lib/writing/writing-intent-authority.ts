/**
 * Server-side authority for composed writing.
 *
 * Whether a variant is an `assist_only` proposal is **not** the caller's claim to make, and it is
 * not decided by a caller-supplied run pointer either. Two independent anchors carry it:
 *
 * 1. **The surface.** `isAssistOnlySurface` is a property of the artifact
 *    (`WRITING_SURFACE_CAPABILITIES[...].mandate`). A reply, comment, or direct message is a
 *    proposal by construction, so the mandate holds even if every pointer in the payload is wrong.
 * 2. **The workflow run row** Signals wrote at dispatch (`buildStoredRunConfig`), falling back to
 *    the template config — the composition, consumer, and enabled surfaces come from there.
 *
 * Both directions fail closed: an assist-only surface *must* carry an intent naming a genuinely
 * composed run, a composed run *must* produce a matching intent, and an uncomposed run *must not*
 * carry one. A dishonest run pointer therefore cannot reach the platform-native lane; at most it
 * misattributes work between composed runs, all of which pin explicit approval.
 */

import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { DbRunner } from "@/lib/db/client";
import { workflowRuns, workflowTemplates } from "@/lib/db/schema";
import { isAssistOnlySurface } from "@/lib/writing/capabilities";
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
  | "writing_intent_target_mismatch"
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
 * Reconcile a submitted intent against the composition the *artifact* demands.
 *
 * The run pointer in `generationMetadata.agent.workflowRunId` is caller-supplied and there is no
 * ambient run context on the agent-tools route, so it cannot be the anchor on its own: a caller
 * could name an ordinary run, omit the intent, and slide a proposal into the platform-native lane.
 * The surface is the anchor instead. An assist-only surface requires an intent whose lineage
 * resolves to a genuinely composed run, so the only freedom a dishonest pointer buys is choosing
 * *which* composed run to attribute the work to — every one of which pins explicit approval.
 *
 * Returns the validated record for a composed artifact and `null` for ordinary writing.
 */
export function assertWritingIntentAuthority(input: {
  authority: ComposedRunAuthority | null;
  intent: unknown;
  surface: SurfaceId;
  platform: string;
  targetId: string | null;
  workflowRunId: string;
}): WritingIntentRecord | null {
  const submitted = input.intent;
  const assistOnlySurface = isAssistOnlySurface(input.surface);

  if (submitted === undefined || submitted === null) {
    if (assistOnlySurface) {
      return fail(
        "writing_intent_required",
        `Surface ${input.surface} is assist-only and exists only for composed proposals; metadata.writing.intent is required`,
      );
    }
    if (input.authority) {
      return fail(
        "writing_intent_required",
        `Workflow run ${input.workflowRunId} is composed as ${input.authority.composition.consumer} and requires metadata.writing.intent`,
      );
    }
    return null;
  }

  if (!input.authority) {
    return fail(
      "writing_intent_not_permitted",
      "The workflow run named by this intent is not composed for writing intents",
    );
  }
  const { composition, templateId } = input.authority;
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
  // One artifact, one acting identity. The Personality guard validates `writing.targetId`; if the
  // intent names something else, the materialized proposal would carry contradictory lineage.
  if (record.target.platform !== input.platform || record.target.targetId !== input.targetId) {
    return fail(
      "writing_intent_target_mismatch",
      "Writing intent target does not match the variant's acting target",
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

/**
 * The run an artifact's composition must be resolved against.
 *
 * A submitted intent names its own run; that is the one whose composition has to hold. Falling back
 * to the generation pointer only matters for ordinary writing, where no composition applies.
 */
export function composedRunIdForVariant(input: {
  intent: unknown;
  generationWorkflowRunId: string;
}): string {
  const record = readWritingIntentRecord(input.intent);
  return record?.lineage.workflowRunId ?? input.generationWorkflowRunId;
}
