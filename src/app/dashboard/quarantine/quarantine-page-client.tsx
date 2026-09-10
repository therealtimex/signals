"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Search,
  ShieldAlert,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CandidateReviewDialog } from "./candidate-review-dialog";
import {
  buildQuarantineFilterParams,
  failureReasonFilterParam,
  quarantineFiltersActive,
  quarantinePageUrl,
  statusFilterParam,
  updateQuarantineFilterUrl,
} from "./quarantine-utils";
import type {
  QuarantineCandidateItem,
  QuarantinePageStats,
  QuarantineStatusFilter,
} from "./types";

const STATUS_FILTERS: Array<{
  value: QuarantineStatusFilter;
  label: string;
  stat?: keyof QuarantinePageStats;
}> = [
  { value: "identity_unverified", label: "Awaiting", stat: "identity_unverified" },
  { value: "promoted", label: "Promoted", stat: "promoted" },
  { value: "dismissed", label: "Dismissed", stat: "dismissed" },
  { value: "all", label: "All" },
];

function formatReason(reason: string): string {
  return reason.replaceAll("_", " ");
}

function CandidateStatusBadge({ status }: { status: QuarantineCandidateItem["status"] }) {
  if (status === "promoted") return <Badge variant="success">Promoted</Badge>;
  if (status === "dismissed") return <Badge variant="neutral">Dismissed</Badge>;
  return <Badge variant="warning">Needs verification</Badge>;
}

export function CandidateCard({
  candidate,
  onReview,
}: {
  candidate: QuarantineCandidateItem;
  onReview: (candidate: QuarantineCandidateItem) => void;
}) {
  return (
    <Card className="gap-4 p-5" data-testid={`quarantine-candidate-${candidate.id}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-warning/10 p-2 text-warning">
          <ShieldAlert className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{candidate.proposedName}</h2>
            <CandidateStatusBadge status={candidate.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[candidate.proposedTitle, candidate.proposedCompany].filter(Boolean).join(" · ") ||
              "LinkedIn identity candidate"}
          </p>
        </div>
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <p className="capitalize">Gate: {formatReason(candidate.failureReason)}</p>
        <p className="sm:text-right">
          {candidate.attemptCount} {candidate.attemptCount === 1 ? "attempt" : "attempts"}
        </p>
        {candidate.seedValue ? (
          <p className="truncate sm:col-span-2" title={candidate.seedValue}>
            Source: {candidate.seedValue}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <a
          href={candidate.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          LinkedIn <ExternalLink className="size-3" />
        </a>
        <Button size="sm" variant="outline" onClick={() => onReview(candidate)}>
          Review candidate
        </Button>
      </div>
    </Card>
  );
}

function StatusFilters({
  currentStatus,
  stats,
  onChange,
}: {
  currentStatus: QuarantineStatusFilter;
  stats: QuarantinePageStats;
  onChange: (status: QuarantineStatusFilter) => void;
}) {
  const total = stats.identity_unverified + stats.promoted + stats.dismissed;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Candidate status filters">
      {STATUS_FILTERS.map((filter) => (
        <Button
          key={filter.value}
          type="button"
          size="sm"
          variant={currentStatus === filter.value ? "default" : "outline"}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
          <Badge variant={currentStatus === filter.value ? "secondary" : "neutral"}>
            {filter.stat ? stats[filter.stat] : total}
          </Badge>
        </Button>
      ))}
    </div>
  );
}

type FilterUpdate = (key: string, value?: string) => void;

function AwaitingCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge variant="warning" className="px-3 py-1">
      <Clock3 /> {count} awaiting verification
    </Badge>
  );
}

function SourceRunFilter({ workflowRunId }: { workflowRunId?: string }) {
  if (!workflowRunId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      Showing source run
      <Badge variant="outline" className="font-mono">{workflowRunId}</Badge>
      <Button variant="link" size="sm" asChild>
        <Link href={`/dashboard/workflows/${workflowRunId}`}>View run</Link>
      </Button>
    </div>
  );
}

function QuarantineFiltersCard({
  currentStatus,
  currentSearch,
  currentFailureReason,
  currentWorkflowRunId,
  failureReasons,
  stats,
  filtersActive,
  onFilter,
}: {
  currentStatus: QuarantineStatusFilter;
  currentSearch?: string;
  currentFailureReason?: string;
  currentWorkflowRunId?: string;
  failureReasons: string[];
  stats: QuarantinePageStats;
  filtersActive: boolean;
  onFilter: FilterUpdate;
}) {
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onFilter("search", String(data.get("search") ?? "").trim());
  }

  return (
    <Card className="gap-4 p-4">
      <StatusFilters
        currentStatus={currentStatus}
        stats={stats}
        onChange={(status) => onFilter("status", statusFilterParam(status))}
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(13rem,auto)_auto]">
        <form className="flex gap-2" onSubmit={submitSearch}>
          <Input
            key={currentSearch ?? ""}
            name="search"
            type="search"
            defaultValue={currentSearch}
            placeholder="Search person, company, title, or seed"
            aria-label="Search quarantined candidates"
          />
          <Button type="submit" variant="outline" aria-label="Search">
            <Search />
          </Button>
        </form>
        <Select
          value={currentFailureReason ?? "all"}
          onValueChange={(reason) => onFilter("reason", failureReasonFilterParam(reason))}
        >
          <SelectTrigger className="w-full" aria-label="Filter by gate failure">
            <SelectValue placeholder="All gate failures" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All gate failures</SelectItem>
            {failureReasons.map((reason) => (
              <SelectItem key={reason} value={reason} className="capitalize">
                {formatReason(reason)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive ? (
          <Button variant="ghost" asChild>
            <Link href="/dashboard/quarantine">Clear filters</Link>
          </Button>
        ) : null}
      </div>
      <SourceRunFilter workflowRunId={currentWorkflowRunId} />
    </Card>
  );
}

function QuarantineCandidateResults({
  candidates,
  filtersActive,
  onReview,
}: {
  candidates: QuarantineCandidateItem[];
  filtersActive: boolean;
  onReview: (candidate: QuarantineCandidateItem) => void;
}) {
  if (candidates.length > 0) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {candidates.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} onReview={onReview} />
        ))}
      </div>
    );
  }
  return (
    <EmptyState
      icon={filtersActive ? Search : CheckCircle2}
      mood="curious"
      title={filtersActive ? "No candidates match these filters" : "Quarantine is clear"}
      description={filtersActive
        ? "Adjust or clear the filters to review other Snowball candidates."
        : "Failed Snowball identity gates will preserve their proposed person and company here for review."}
      action={filtersActive ? (
        <Button asChild><Link href="/dashboard/quarantine">Clear filters</Link></Button>
      ) : undefined}
    />
  );
}

export function QuarantinePageClient({
  candidates,
  total,
  page,
  pageSize,
  stats,
  failureReasons,
  currentStatus,
  currentSearch,
  currentFailureReason,
  currentWorkflowRunId,
}: {
  candidates: QuarantineCandidateItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: QuarantinePageStats;
  failureReasons: string[];
  currentStatus: QuarantineStatusFilter;
  currentSearch?: string;
  currentFailureReason?: string;
  currentWorkflowRunId?: string;
}) {
  const router = useRouter();
  const [selectedCandidate, setSelectedCandidate] = useState<QuarantineCandidateItem | null>(null);
  const filterState = useMemo(() => ({
    status: currentStatus,
    search: currentSearch,
    failureReason: currentFailureReason,
    workflowRunId: currentWorkflowRunId,
  }), [currentFailureReason, currentSearch, currentStatus, currentWorkflowRunId]);
  const filterParams = useMemo(() => buildQuarantineFilterParams(filterState), [filterState]);

  const updateFilter = useCallback((key: string, value?: string) => {
    router.push(updateQuarantineFilterUrl(filterParams, key, value));
  }, [filterParams, router]);

  const createPageUrl = useCallback(
    (nextPage: number) => quarantinePageUrl(filterParams, nextPage),
    [filterParams],
  );
  const filtersActive = quarantineFiltersActive(filterState);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidate quarantine"
        description="Review Snowball discoveries that remain isolated from canonical contacts and companies until their LinkedIn identity is verified."
        actions={<AwaitingCountBadge count={stats.identity_unverified} />}
      />

      <QuarantineFiltersCard
        currentStatus={currentStatus}
        currentSearch={currentSearch}
        currentFailureReason={currentFailureReason}
        currentWorkflowRunId={currentWorkflowRunId}
        failureReasons={failureReasons}
        stats={stats}
        filtersActive={filtersActive}
        onFilter={updateFilter}
      />

      <QuarantineCandidateResults
        candidates={candidates}
        filtersActive={filtersActive}
        onReview={setSelectedCandidate}
      />

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        createPageUrl={createPageUrl}
      />

      <CandidateReviewDialog
        key={selectedCandidate?.id ?? "none"}
        candidate={selectedCandidate}
        open={selectedCandidate !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCandidate(null);
        }}
      />
    </div>
  );
}
