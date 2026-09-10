import type {
  SnowballCandidateStats,
  SnowballCandidateView,
} from "@/lib/workflows/snowball-candidates";
import type { WorkflowRunAgentThread } from "@/lib/workflows/workflow-run-agent-thread";

export type QuarantineStatusFilter = SnowballCandidateView["status"] | "all";

export type QuarantineCandidateItem = SnowballCandidateView & {
  runStatus: string | null;
  agentThread: WorkflowRunAgentThread;
};

export type QuarantinePageStats = SnowballCandidateStats;
