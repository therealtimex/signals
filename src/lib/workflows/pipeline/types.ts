import type { EnvLike } from "@/lib/rtx/env";
import type { ProfilePipelineFilters } from "@/lib/db/queries/profile-pipeline-backlog";

/** Default contacts per manual pipeline run (template config may override). */
export const PROFILE_PIPELINE_DEFAULT_BATCH = 20;
/** Hard cap enforced by planner and run input validation. */
export const PROFILE_PIPELINE_MAX_BATCH = 50;

export type PipelineExecutor = "code" | "llm" | "agent";

export type PipelineStepDecl = {
  id: string;
  executor: PipelineExecutor;
  handler: string;
  options?: Record<string, unknown>;
};

export type PipelineConfig = {
  version: number;
  planner: string;
  batchSize?: number;
  filters?: ProfilePipelineFilters;
  scheduleDrain?: boolean;
  steps: PipelineStepDecl[];
};

export type PipelineContactOutcome = {
  contactId: string;
  status: "updated" | "generated" | "verified" | "skipped" | "failed";
  reason?: string;
  detail?: Record<string, unknown>;
};

export type PipelineStepReport = {
  stepId: string;
  outcomes: PipelineContactOutcome[];
  aborted: boolean;
  abortReason?: string;
};

export type PipelineContactStepTiming = {
  durationMs: number;
  completedAtMs?: number;
};

export type PipelineRunScope = {
  /** Stable selected-contact order for batch preparation within contact-major execution. */
  contactIds: readonly string[];
  /** Handler-owned state that lives for exactly one pipeline run. */
  resources: Map<string, unknown>;
  /** Registers best-effort teardown that runs even when execution throws. */
  deferCleanup: (cleanup: () => void | Promise<void>) => void;
};

export type PipelineStepContext = {
  workflowRunId: string;
  stepId: string;
  trigger: "template" | "scheduled";
  forcePersona: boolean;
  personaStale: boolean;
  fetchImpl: typeof fetch;
  env: EnvLike;
  options?: Record<string, unknown>;
  runScope?: PipelineRunScope;
  appendThreadMessage: (markdown: string) => Promise<void>;
  /** Records a per-contact pipeline step immediately (for live runs and real timing). */
  recordContactOutcome?: (
    outcome: PipelineContactOutcome,
    timing: PipelineContactStepTiming,
  ) => void;
};

export type PipelineStepHandler = (
  contactIds: string[],
  ctx: PipelineStepContext,
) => Promise<PipelineStepReport>;

export type PipelineRunResult = {
  backlogTotal: number;
  batchSize: number;
  selected: number;
  processed: number;
  profilesHydrated: number;
  avatarsUpdated: number;
  personasGenerated: number;
  skipped: Record<string, number>;
  failed: number;
  aborted: number;
  avatarOutcomes: { updated: number; gravatarVerified: number };
  hydrationOutcomes: {
    updated: number;
    notFound: number;
    /**
     * Contacts whose hydration was skipped by the anonymous-X cooldown. Surfaced because that
     * breaker lives in a module-level variable — without this a stalled pipeline leaves no trace
     * in the run record and takes aggregating many runs to spot (#436).
     */
    deferred: number;
  };
  cleared: number;
  remainingBacklog: number;
  complete: boolean;
};
