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

export type PipelineStepContext = {
  workflowRunId: string;
  stepId: string;
  trigger: "template" | "scheduled";
  forcePersona: boolean;
  personaStale: boolean;
  fetchImpl: typeof fetch;
  env: EnvLike;
  appendThreadMessage: (markdown: string) => Promise<void>;
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
  avatarsUpdated: number;
  personasGenerated: number;
  skipped: Record<string, number>;
  failed: number;
  aborted: number;
  avatarOutcomes: { updated: number; gravatarVerified: number };
  cleared: number;
  remainingBacklog: number;
  complete: boolean;
};
