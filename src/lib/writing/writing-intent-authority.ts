/**
 * Server-side authority for composed writing.
 *
 * Every payload field an agent sends is caller-owned — the run pointer and the surface alike — so
 * neither can be the authority, and neither is. The anchor is the **launch**, bound to its dispatch
 * by a capability rather than by a selector:
 *
 * - `run-template-via-rtx.ts` mints a writing scope token while dispatching a composed run, stores
 *   only its hash on the server-owned run row, and writes the plaintext into that dispatch's brief.
 * - `mergeLaunchMetadata` stamps `writing.composition` onto a launch only when that token verifies.
 *   A caller-supplied composition is stripped; a stamped one is immutable; naming a composed run in
 *   `writing.runs` mints nothing; a presented token that does not verify fails the call outright.
 * - A writing variant structurally requires a `launchId`, so every artifact reaches this scope.
 *
 * `assertWritingIntentAuthority` validates the submission against that stamped scope, so mandate,
 * consumer, allowed surfaces, and run/template lineage all come from server state — including
 * `generationMetadata.agent.workflowRunId`, which is compared to the scope's run rather than to
 * itself, so cross-run attribution is rejected rather than merely detected.
 *
 * `isAssistOnlySurface` stays as defence in depth: a proposal surface outside any composed scope is
 * refused rather than quietly treated as ordinary writing.
 *
 * Boundary, stated so future changes are reviewed against the real model: the agent-tools route has
 * no per-invocation identity, so ordinary platform-native writing by the same credential cannot be
 * attributed to a dispatch at all. See "What this does not claim" in
 * `docs/composable-writing-intent.md`.
 */

import { eq } from "drizzle-orm";
import { AgentToolError } from "@/lib/agent-tools/types";
import type { DbRunner } from "@/lib/db/client";
import { launches, workflowRuns, workflowTemplates } from "@/lib/db/schema";
import { launchCompositionSchema, type LaunchComposition } from "@/lib/writing/contracts";
import { isAssistOnlySurface } from "@/lib/writing/capabilities";
import type { SurfaceId } from "@/lib/writing/surfaces";
import {
  readWritingIntentComposition,
  readWritingIntentRecord,
  type WritingIntentComposition,
  type WritingIntentRecord,
} from "@/lib/writing/writing-intent";
import {
  WRITING_SCOPE_TOKEN_CONFIG_KEY,
  parseWritingScopeToken,
  writingScopeTokenMatches,
} from "@/lib/writing/writing-scope-token";

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
  | "writing_intent_lineage_mismatch"
  | "composed_scope_required";

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
  /** Server-stamped scope on the variant's launch; `null` for an ordinary writing launch. */
  composition: LaunchComposition | null;
  intent: unknown;
  surface: SurfaceId;
  platform: string;
  targetId: string | null;
  workflowRunId: string;
}): WritingIntentRecord | null {
  const submitted = input.intent;
  const composition = input.composition;

  if (!composition) {
    if (submitted !== undefined && submitted !== null) {
      return fail(
        "writing_intent_not_permitted",
        "This launch was not created under a composed dispatch, so it cannot carry a writing intent",
      );
    }
    if (isAssistOnlySurface(input.surface)) {
      return fail(
        "composed_scope_required",
        `Surface ${input.surface} is assist-only and exists only inside a composed dispatch; this launch has no composition scope`,
      );
    }
    return null;
  }

  if (submitted === undefined || submitted === null) {
    return fail(
      "writing_intent_required",
      `This launch is scoped to ${composition.consumer} and requires metadata.writing.intent`,
    );
  }
  const templateId = composition.templateId;
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
  // Both the intent's lineage and the caller's generation pointer are checked against the *server*
  // value, so neither can be moved to escape the scope.
  if (record.lineage.workflowRunId !== composition.workflowRunId) {
    return fail(
      "writing_intent_lineage_mismatch",
      "Writing intent lineage names a different workflow run than the launch scope",
    );
  }
  if (input.workflowRunId !== composition.workflowRunId) {
    return fail(
      "writing_intent_lineage_mismatch",
      "generationMetadata.agent.workflowRunId does not match the launch scope",
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
 * Resolve the composition a dispatch-issued capability token authorises.
 *
 * The token names its own run, so this is a row lookup plus a constant-time hash check against the
 * server-stored value. A token for a different dispatch does not verify, and no token at all
 * resolves to nothing — a caller cannot select a composed run by naming it.
 */
export function resolveComposedRunAuthorityByToken(
  runner: DbRunner,
  presentedToken: unknown,
): ComposedRunAuthority | null {
  const parsed = parseWritingScopeToken(presentedToken);
  if (!parsed) return null;
  const run = runner
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, parsed.workflowRunId))
    .get();
  if (!run) return null;
  if (!writingScopeTokenMatches(parsed.token, object(run.config)[WRITING_SCOPE_TOKEN_CONFIG_KEY])) {
    return null;
  }
  return resolveComposedRunAuthority(runner, run.id);
}

/** Read the server-stamped composition scope off a launch. */
export function readLaunchComposition(
  runner: DbRunner,
  launchId: string,
): LaunchComposition | null {
  const launch = runner.select().from(launches).where(eq(launches.id, launchId)).get();
  if (!launch) return null;
  const parsed = launchCompositionSchema.safeParse(
    object(object(launch.metadata).writing).composition,
  );
  return parsed.success ? parsed.data : null;
}
