import {
  createRtxPublishThread,
  getSignalsRtxWorkspaceSlug,
  getRtxThreadPresence,
} from "@/lib/rtx/cli-provisioning";
import type { EnvLike } from "@/lib/rtx/env";
import { MANUAL_TERMINAL_TEARDOWN_INSTRUCTION } from "@/lib/rtx/teardown";

export const SIGNALS_ORCHESTRATOR_THREAD_NAME = "Signals Orchestrator";
export const DEFAULT_ORCHESTRATOR_THREAD_SLUG = "signals-orchestrator";

let inMemoryOrchestratorThreadSlug: string | null = null;

export function _resetOrchestratorThreadCacheForTests() {
  inMemoryOrchestratorThreadSlug = null;
}

export interface ResolveOrchestratorThreadResult {
  workspaceSlug: string;
  threadSlug: string;
  threadName: string;
  resolution: "reused" | "created" | "recreated" | "fallback";
}

/**
 * Resolves or provisions the dedicated "Signals Orchestrator" thread in the RealTimeX workspace.
 * This thread is the designated cockpit for all inbound/outbound webhook tasks and agentic cascade routing.
 */
export async function getOrCreateOrchestratorThread(
  options?: {
    workspaceSlug?: string;
    threadName?: string;
  },
  env: EnvLike = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ResolveOrchestratorThreadResult> {
  const workspaceSlug = options?.workspaceSlug?.trim() || getSignalsRtxWorkspaceSlug(env);
  const threadName = options?.threadName?.trim() || SIGNALS_ORCHESTRATOR_THREAD_NAME;

  // 1. Check environment override
  const envSlug = env.SIGNALS_ORCHESTRATOR_THREAD_SLUG?.trim();
  const candidateSlug = envSlug || inMemoryOrchestratorThreadSlug || DEFAULT_ORCHESTRATOR_THREAD_SLUG;

  // 2. Check if thread already exists in RealTimeX
  const presence = await getRtxThreadPresence(workspaceSlug, candidateSlug, env, fetchImpl);
  if (presence === "exists") {
    inMemoryOrchestratorThreadSlug = candidateSlug;
    return {
      workspaceSlug,
      threadSlug: candidateSlug,
      threadName,
      resolution: "reused",
    };
  }

  // 3. If missing, provision thread in RealTimeX
  try {
    const createdSlug = await createRtxPublishThread(workspaceSlug, threadName, env, fetchImpl);
    inMemoryOrchestratorThreadSlug = createdSlug;
    return {
      workspaceSlug,
      threadSlug: createdSlug,
      threadName,
      resolution: presence === "missing" ? "recreated" : "created",
    };
  } catch {
    // Fallback if RealTimeX CLI is offline
    return {
      workspaceSlug,
      threadSlug: candidateSlug,
      threadName,
      resolution: "fallback",
    };
  }
}

/**
 * Standard instructions for the Signals Orchestrator agent when handling a webhook handoff.
 */
export function buildOrchestratorHandoffInstruction(): string {
  return [
    "You are the Signals GTM Orchestrator terminal agent.",
    "",
    "## Responsibilities",
    "1. Review incoming workflow completion events, newly mapped contact cohorts, and routing recommendations.",
    "2. If cascade policy is immediate and action is approved: invoke `dispatch_follow_on_workflow` or `start_workflow` via Signals agent tools.",
    "3. If cascade policy is supervised: post the cohort analysis and suggested follow-on actions for the operator to approve in this thread.",
    `4. TEARDOWN & RESOURCE RELEASE PROTOCOL: ${MANUAL_TERMINAL_TEARDOWN_INSTRUCTION}`,
  ].join("\n");
}
