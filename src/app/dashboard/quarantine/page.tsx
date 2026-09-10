import { getWorkflowRun } from "@/lib/db/queries/workflows";
import { parsePaginationParams } from "@/lib/pagination";
import {
  getSnowballCandidateStats,
  listSnowballCandidateFailureReasons,
  listSnowballCandidates,
  type SnowballCandidateStatus,
} from "@/lib/workflows/snowball-candidates";
import { resolveWorkflowRunAgentThread } from "@/lib/workflows/workflow-run-agent-thread";
import { QuarantinePageClient } from "./quarantine-page-client";
import type { QuarantineCandidateItem, QuarantineStatusFilter } from "./types";

const CANDIDATE_STATUSES: SnowballCandidateStatus[] = [
  "identity_unverified",
  "promoted",
  "dismissed",
];

function parseStatus(value: string | undefined): QuarantineStatusFilter {
  if (value === "all") return "all";
  return CANDIDATE_STATUSES.find((status) => status === value) ?? "identity_unverified";
}

export default async function QuarantinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { page, pageSize } = parsePaginationParams(params);
  const status = parseStatus(params.status);
  const workflowRunId = params.workflowRunId?.trim() || undefined;
  const search = params.search?.trim() || undefined;
  const failureReason = params.reason?.trim() || undefined;
  const result = listSnowballCandidates({
    ...(status === "all" ? {} : { status }),
    workflowRunId,
    search,
    failureReason,
    page,
    pageSize,
  });
  const candidates: QuarantineCandidateItem[] = result.data.map((candidate) => {
    const run = getWorkflowRun(candidate.workflowRunId);
    return {
      ...candidate,
      runStatus: run?.status ?? null,
      agentThread: run
        ? resolveWorkflowRunAgentThread(run)
        : { state: "none", threadPath: null },
    };
  });

  return (
    <QuarantinePageClient
      candidates={candidates}
      total={result.total}
      page={page}
      pageSize={pageSize}
      stats={getSnowballCandidateStats()}
      failureReasons={listSnowballCandidateFailureReasons()}
      currentStatus={status}
      currentSearch={search}
      currentFailureReason={failureReason}
      currentWorkflowRunId={workflowRunId}
    />
  );
}
