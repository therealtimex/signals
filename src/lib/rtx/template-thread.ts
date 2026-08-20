import { updateTemplate } from "@/lib/db/queries/workflow-templates";
import type { WorkflowTemplate } from "@/lib/db/types";
import {
  createRtxPublishThread,
  getRtxThreadPresence,
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
  | "fresh";

export type ResolveTemplateThreadResult = {
  threadSlug: string;
  resolution: TemplateThreadResolution;
};

export type ResolveTemplateThreadInput = {
  template: Pick<WorkflowTemplate, "id" | "name" | "rtxThreadSlug">;
  workspaceSlug: string;
  /** Name used only when a thread has to be created. */
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

  if (input.freshThread) {
    const threadSlug = await createRtxPublishThread(
      workspaceSlug,
      threadName,
      env,
      fetchImpl
    );
    return { threadSlug, resolution: "fresh" };
  }

  const storedSlug = template.rtxThreadSlug?.trim() || null;
  if (storedSlug) {
    const presence = await getRtxThreadPresence(
      workspaceSlug,
      storedSlug,
      env,
      fetchImpl
    );
    // "unknown" keeps the pointer: a transient API failure must not fork the timeline.
    if (presence !== "missing") {
      return { threadSlug: storedSlug, resolution: "reused" };
    }
  }

  const threadSlug = await createRtxPublishThread(
    workspaceSlug,
    threadName,
    env,
    fetchImpl
  );
  updateTemplate(template.id, { rtxThreadSlug: threadSlug });

  return { threadSlug, resolution: storedSlug ? "recreated" : "created" };
}
