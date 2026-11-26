import { claimTemplateThreadSlug, getTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowTemplate } from "@/lib/db/types";
import {
  createRtxPublishThread,
  getRtxThread,
  renameRtxThread,
  type RtxThreadLookup,
} from "@/lib/rtx/cli-provisioning";
import type { EnvLike } from "@/lib/rtx/env";

/** How the run ended up with the thread it is about to dispatch into. */
export type TemplateThreadResolution =
  /** The template's dedicated thread already existed and was reused. */
  | "reused"
  /** No pointer yet — a dedicated thread was created and persisted. */
  | "created"
  /** The pointer was stale (thread deleted in RealTimeX) — recreated and persisted. */
  | "recreated"
  /** Caller asked for an isolated run — a throwaway thread that is not persisted. */
  | "fresh"
  /** The dedicated thread failed its liveness check — a new one was created and persisted (#572). */
  | "replaced";

export type ResolveTemplateThreadResult = {
  threadSlug: string;
  resolution: TemplateThreadResolution;
  threadName: string;
  renameAttempted: boolean;
  renamed: boolean;
  renameError?: string;
};

export type ResolveTemplateThreadInput = {
  template: Pick<WorkflowTemplate, "id" | "name" | "rtxThreadSlug">;
  workspaceSlug: string;
  /** Desired display name for both newly created and reused threads. */
  threadName: string;
  /** Escape hatch: run in a throwaway thread and leave the template pointer alone. */
  freshThread?: boolean;
};

/**
 * Resolve the dedicated thread for a workflow template — "1 template = 1 thread".
 *
 * Runs of the same template become new sessions inside one persistent thread instead
 * of flooding the workspace sidebar with `name (2)`, `name (3)`, ... duplicates.
 */
export async function getOrCreateTemplateThread(
  input: ResolveTemplateThreadInput,
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ResolveTemplateThreadResult> {
  const { template, workspaceSlug, threadName } = input;

  const baseResult = {
    threadName,
    renameAttempted: false,
    renamed: false,
  };

  const convergeName = async (
    threadSlug: string,
    lookup?: RtxThreadLookup,
  ): Promise<Pick<ResolveTemplateThreadResult, "renameAttempted" | "renamed" | "renameError">> => {
    const current = lookup ?? await getRtxThread(workspaceSlug, threadSlug, env, fetchImpl);
    if (current.presence !== "exists" || current.name === threadName) {
      return { renameAttempted: false, renamed: false };
    }
    try {
      await renameRtxThread(workspaceSlug, threadSlug, threadName, env, fetchImpl);
      return { renameAttempted: true, renamed: true };
    } catch (error) {
      return {
        renameAttempted: true,
        renamed: false,
        renameError: error instanceof Error ? error.message : "Thread rename failed",
      };
    }
  };

  if (input.freshThread) {
    // Marked so a one-off is not mistaken for the dedicated thread, which RTX would
    // otherwise disambiguate only with a `(2)` suffix.
    const threadSlug = await createRtxPublishThread(
      workspaceSlug,
      `${threadName} — one-off`,
      env,
      fetchImpl
    );
    return { threadSlug, resolution: "fresh", ...baseResult };
  }

  const storedSlug = template.rtxThreadSlug?.trim() || null;
  if (storedSlug) {
    const lookup = await getRtxThread(
      workspaceSlug,
      storedSlug,
      env,
      fetchImpl
    );
    // "unknown" keeps the pointer: a transient API failure must not fork the timeline.
    if (lookup.presence !== "missing") {
      return {
        threadSlug: storedSlug,
        resolution: "reused",
        ...baseResult,
        ...(await convergeName(storedSlug, lookup)),
      };
    }
  }

  const threadSlug = await createRtxPublishThread(
    workspaceSlug,
    threadName,
    env,
    fetchImpl
  );

  // A concurrent run may have pointed the template somewhere else while we were
  // provisioning; whoever won the swap owns the timeline and we join it.
  const claimed = claimTemplateThreadSlug(template.id, storedSlug, threadSlug);
  if (claimed !== threadSlug) {
    return {
      threadSlug: claimed,
      resolution: "reused",
      ...baseResult,
      ...(await convergeName(claimed)),
    };
  }

  return {
    threadSlug,
    resolution: storedSlug ? "recreated" : "created",
    ...baseResult,
  };
}

/** Replacements in flight per template; a concurrent caller waits for the one ahead of it. */
const replacementsInFlight = new Map<string, Promise<unknown>>();

/**
 * Move a template off a dedicated thread that is no longer fit to receive dispatches (#572).
 *
 * The dead thread is left in place for the Human to read; the template pointer moves to a new
 * thread so later runs stop landing in it too. Replacements of one template run one at a time, and
 * a caller whose stale thread was already replaced while it waited joins that thread instead of
 * creating one that would lose the pointer swap and be left empty in RealTimeX. The swap itself
 * stays a compare-and-set, so a replacement from another process still converges on one pointer.
 */
export async function replaceTemplateThread(
  input: {
    template: Pick<WorkflowTemplate, "id">;
    workspaceSlug: string;
    threadName: string;
    staleThreadSlug: string;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolveTemplateThreadResult> {
  const templateId = input.template.id;
  const ahead = replacementsInFlight.get(templateId) ?? Promise.resolve();
  const replacement = ahead
    .catch(() => undefined)
    .then(() => replaceTemplateThreadNow(input, env, fetchImpl));
  replacementsInFlight.set(templateId, replacement);
  try {
    return await replacement;
  } finally {
    if (replacementsInFlight.get(templateId) === replacement) {
      replacementsInFlight.delete(templateId);
    }
  }
}

async function replaceTemplateThreadNow(
  input: Parameters<typeof replaceTemplateThread>[0],
  env: EnvLike,
  fetchImpl: typeof fetch,
): Promise<ResolveTemplateThreadResult> {
  const baseResult = {
    threadName: input.threadName,
    renameAttempted: false,
    renamed: false,
  };
  const current = getTemplate(input.template.id)?.rtxThreadSlug?.trim() || null;
  if (current && current !== input.staleThreadSlug) {
    return { threadSlug: current, resolution: "reused", ...baseResult };
  }
  const threadSlug = await createRtxPublishThread(
    input.workspaceSlug,
    input.threadName,
    env,
    fetchImpl,
  );
  const claimed = claimTemplateThreadSlug(input.template.id, input.staleThreadSlug, threadSlug);
  return {
    threadSlug: claimed,
    resolution: claimed === threadSlug ? "replaced" : "reused",
    ...baseResult,
  };
}
