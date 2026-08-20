"use client";

import {
  useState,
  useCallback,
  Suspense,
  useMemo,
  useEffect,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  PenSquare,
  RotateCcw,
  X,
} from "lucide-react";
import { ComposeDialog } from "@/components/compose-dialog";
import { ContentStatusBadge } from "@/components/content-status-badge";
import { EmptyState } from "@/components/empty-state";
import { EngagementMetrics } from "@/components/engagement-metrics";
import { FeedbackBanner } from "@/components/feedback-banner";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { PlatformBadge } from "@/components/platform-badge";
import { RowActionsMenu, type RowAction } from "@/components/row-actions-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePublishJobs } from "@/hooks/use-publish-jobs";
import type { ContentItemWithPost } from "@/lib/db/types";
import { PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";
import {
  getEngagementMetrics,
  parseEngagementSnapshot,
  resolveContentPlatform,
} from "@/lib/platforms/content-platform";
import type { PublishJobTarget } from "@/lib/publish/types";
import { cn } from "@/lib/utils";
import {
  getContentOriginView,
  hasNonDefaultContentFilters,
  resetContentListParams,
  shouldActivateContentRow,
  updateContentListParams,
} from "./content-list-utils";
import {
  getContentRowActionKinds,
  getOpenPlatformLabel,
  type ContentRowActionKind,
} from "./content-row-actions";

const originFilters = [
  { value: "all", label: "All" },
  { value: "authored", label: "Posts" },
  { value: "received", label: "Inbound" },
  { value: "drafts", label: "Drafts" },
];

const platformFilters = [
  { value: "all", label: "All Platforms" },
  { value: "x", label: "X" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "gmail", label: "Gmail" },
];

const contentTypeLabels: Record<string, string> = {
  post: "Post",
  article: "Article",
  thread: "Thread",
  reply: "Reply",
  image: "Image",
  video: "Video",
  email: "Email",
  dm: "DM",
  newsletter: "Newsletter",
};

interface ContentListClientProps {
  content: ContentItemWithPost[];
  total: number;
  page: number;
  pageSize: number;
  currentType?: string;
  currentOrigin?: string;
  currentStatus?: string;
  currentPlatform?: string;
}

type SentBanner = {
  jobId: string;
  threadPath: string | null;
};

function toContentUrl(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/dashboard/content?${query}` : "/dashboard/content";
}

function formatDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(text: string | null | undefined, length: number): string {
  if (!text) return "—";
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function renderEngagement(item: ContentItemWithPost) {
  const snapshot = parseEngagementSnapshot(item.post?.engagementSnapshot);
  const platform = resolveContentPlatform(item);
  if (getEngagementMetrics(platform, snapshot).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return <EngagementMetrics snapshot={snapshot} platform={platform} />;
}

function TargetStatusBadge({ target }: { target: PublishJobTarget }) {
  const label = PLATFORM_SHORT_LABELS[target.platform] ?? target.platform;
  const detail = target.error || target.platformUrl || target.status;
  if (target.status === "publishing") {
    return <Badge variant="info" title={detail} aria-label={`${label}: ${detail}`}><Loader2 className="animate-spin motion-reduce:animate-none" />{label}</Badge>;
  }
  if (target.status === "published") {
    return <Badge variant="success" title={detail} aria-label={`${label}: ${detail}`}><CheckCircle2 />{label}</Badge>;
  }
  if (target.status === "failed") {
    return <Badge variant="danger" title={detail} aria-label={`${label}: ${detail}`}><AlertCircle />{label}</Badge>;
  }
  return <Badge variant="neutral" title={detail} aria-label={`${label}: ${detail}`}><Clock />{label}</Badge>;
}

function ContentListInner({
  content,
  total,
  page,
  pageSize,
  currentOrigin,
  currentStatus,
  currentPlatform,
}: ContentListClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [sentBanner, setSentBanner] = useState<SentBanner | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const contentIds = useMemo(() => content.map((item) => item.id), [content]);
  const { jobsByItemId, fetchJobs, checkTerminalTransitions } = usePublishJobs(contentIds);
  const activeOrigin = getContentOriginView(currentOrigin, currentStatus);
  const filtersActive = hasNonDefaultContentFilters(currentOrigin, currentStatus, currentPlatform);

  useEffect(() => {
    checkTerminalTransitions(() => router.refresh());
  }, [checkTerminalTransitions, router, jobsByItemId]);

  const threadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of content) {
      if (item.threadId) counts.set(item.threadId, (counts.get(item.threadId) ?? 0) + 1);
    }
    return counts;
  }, [content]);

  const updateParams = useCallback(
    (key: "origin" | "platform", value: string) => {
      router.push(toContentUrl(updateContentListParams(searchParams, key, value)));
    },
    [router, searchParams]
  );

  const resetFilters = useCallback(() => {
    router.push(toContentUrl(resetContentListParams(searchParams)));
  }, [router, searchParams]);

  const createPageUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage > 1) params.set("page", String(nextPage));
      else params.delete("page");
      return toContentUrl(params);
    },
    [searchParams]
  );

  async function openThread(jobId: string) {
    setActionLoading(`open-${jobId}`);
    try {
      const response = await fetch(`/api/content/publish-jobs/${jobId}/open-thread`, {
        method: "POST",
      });
      const data = await response.json();
      if (data.threadPath) setSentBanner({ jobId, threadPath: data.threadPath });
    } finally {
      setActionLoading(null);
    }
  }

  async function retryPublish(itemId: string) {
    const job = jobsByItemId[itemId];
    if (!job?.payload) return;
    setActionLoading(`retry-${itemId}`);
    try {
      const response = await fetch("/api/content/send-to-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentItemId: itemId,
          platforms: job.payload.platforms,
          targets: job.targets
            .filter((target) => target.targetId)
            .map((target) => ({ targetId: target.targetId })),
          text: job.payload.text,
          mediaAssetIds: job.payload.mediaAssetIds?.length ? job.payload.mediaAssetIds : undefined,
        }),
      });
      const data = await response.json();
      if (data.success) {
        const threadPath = data.rtxWorkspaceSlug && data.rtxThreadSlug
          ? `/workspace/${data.rtxWorkspaceSlug}/t/${data.rtxThreadSlug}`
          : null;
        setSentBanner({ jobId: data.jobId, threadPath });
        await fetchJobs();
        router.refresh();
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function markJobFailed(jobId: string) {
    setActionLoading(`fail-${jobId}`);
    try {
      await fetch(`/api/content/publish-jobs/${jobId}/fail`, { method: "POST" });
      await fetchJobs();
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  function rowActions(item: ContentItemWithPost): RowAction[] {
    const job = jobsByItemId[item.id];
    const loading = Boolean(
      actionLoading?.includes(item.id) || (job?.id && actionLoading?.includes(job.id))
    );
    const platform = resolveContentPlatform(item);
    const platformLabel = platform
      ? PLATFORM_SHORT_LABELS[platform as keyof typeof PLATFORM_SHORT_LABELS] ?? platform
      : null;
    const actionDefinitions: Record<ContentRowActionKind, RowAction> = {
      edit: {
        label: "Edit",
        icon: Pencil,
        disabled: loading,
        onSelect: () => {
          setComposeDraftId(item.id);
          setComposeOpen(true);
        },
      },
      retry: {
        label: "Retry",
        icon: RotateCcw,
        disabled: loading,
        onSelect: () => void retryPublish(item.id),
      },
      "open-thread": {
        label: "Open thread",
        icon: MessageSquare,
        disabled: loading,
        onSelect: () => {
          if (job?.id) void openThread(job.id);
        },
      },
      "open-platform": {
        label: getOpenPlatformLabel(platformLabel),
        icon: ExternalLink,
        onSelect: () => {
          if (item.post?.platformUrl) {
            window.open(item.post.platformUrl, "_blank", "noopener,noreferrer");
          }
        },
      },
      "mark-failed": {
        label: "Mark failed",
        icon: AlertCircle,
        destructive: true,
        disabled: loading,
        onSelect: () => {
          if (job?.id) void markJobFailed(job.id);
        },
      },
    };

    return getContentRowActionKinds({
      status: item.status,
      hasRetryPayload: Boolean(job?.payload),
      hasThread: Boolean(job?.rtxThreadSlug && job.id),
      hasPlatformUrl: Boolean(item.post?.platformUrl),
      stale: Boolean(job?.stale),
      hasJob: Boolean(job?.id),
    }).map((kind) => actionDefinitions[kind]);
  }

  function navigateToItem(itemId: string) {
    router.push(`/dashboard/content/${itemId}`);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, itemId: string) {
    if (shouldActivateContentRow(event.key, event.target === event.currentTarget)) {
      event.preventDefault();
      navigateToItem(itemId);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content"
        description="Browse and manage content across platforms."
        actions={(
          <Button
            size="sm"
            onClick={() => {
              setComposeDraftId(null);
              setComposeOpen(true);
            }}
          >
            <PenSquare />
            Compose
          </Button>
        )}
      />

      {sentBanner && (
        <FeedbackBanner
          tone="info"
          onDismiss={() => setSentBanner(null)}
          action={sentBanner.threadPath ? (
            <Button size="xs" variant="secondary" onClick={() => void openThread(sentBanner.jobId)}>
              Open thread
            </Button>
          ) : undefined}
        >
          Sent to agent — open the thread to follow progress.
        </FeedbackBanner>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={activeOrigin} onValueChange={(value) => updateParams("origin", value)}>
          <TabsList>
            {originFilters.map((filter) => (
              <TabsTrigger key={filter.value} value={filter.value}>{filter.label}</TabsTrigger>
            ))}
          </TabsList>
          {originFilters.map((filter) => (
            <TabsContent key={filter.value} value={filter.value} forceMount className="sr-only">
              {filter.label} content view
            </TabsContent>
          ))}
        </Tabs>

        <Tabs value={currentPlatform ?? "all"} onValueChange={(value) => updateParams("platform", value)}>
          <TabsList>
            {platformFilters.map((filter) => (
              <TabsTrigger key={filter.value} value={filter.value}>{filter.label}</TabsTrigger>
            ))}
          </TabsList>
          {platformFilters.map((filter) => (
            <TabsContent key={filter.value} value={filter.value} forceMount className="sr-only">
              {filter.label} filter applied
            </TabsContent>
          ))}
        </Tabs>

        {filtersActive && (
          <Button variant="ghost" size="xs" onClick={resetFilters}>
            <X />
            Reset
          </Button>
        )}
      </div>

      {content.length === 0 ? (
        <Card className="border-border/50">
          <EmptyState
            icon={FileText}
            title="No content yet"
            description="Create new content with Compose, or sync posts from Automation."
            action={(
              <Button
                size="sm"
                onClick={() => {
                  setComposeDraftId(null);
                  setComposeOpen(true);
                }}
              >
                <PenSquare />
                Compose
              </Button>
            )}
          />
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead className="w-20 sm:w-32">Status</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Engagement</TableHead>
                <TableHead className="hidden w-28 sm:table-cell">Date</TableHead>
                <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.map((item) => {
                const job = jobsByItemId[item.id];
                const threadCount = item.threadId ? threadCounts.get(item.threadId) ?? 0 : 0;
                return (
                  <TableRow
                    key={item.id}
                    role="link"
                    tabIndex={0}
                    className={cn(
                      "cursor-pointer hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      job?.stale && "bg-warning/5"
                    )}
                    onClick={() => navigateToItem(item.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                  >
                    <TableCell className="max-w-0 overflow-hidden py-3 align-top whitespace-normal">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PlatformBadge platform={resolveContentPlatform(item)} />
                          <span className="text-xs text-muted-foreground">
                            {contentTypeLabels[item.contentType] ?? item.contentType}
                          </span>
                          {activeOrigin === "all" && item.origin && (
                            <Badge variant="neutral" className="capitalize">{item.origin}</Badge>
                          )}
                          {threadCount > 1 && <Badge variant="neutral">Thread ({threadCount})</Badge>}
                        </div>
                        {item.title && <p className="truncate text-sm font-medium">{item.title}</p>}
                        <div className="text-sm text-muted-foreground break-words">
                          <p className={expandedItems.has(item.id) ? "whitespace-pre-wrap" : undefined}>
                            {expandedItems.has(item.id) ? (item.body ?? "—") : truncate(item.body, 120)}
                          </p>
                          {item.body && item.body.length > 120 && (
                            <button
                              type="button"
                              className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedItems((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                            >
                              {expandedItems.has(item.id) ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                              {expandedItems.has(item.id) ? "Show less" : "Show more"}
                            </button>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="space-y-1.5">
                        <ContentStatusBadge status={item.status} activeView={activeOrigin} stale={job?.stale} />
                        {job?.targets && job.targets.length > 1 ? (
                          <div className="flex flex-wrap gap-1">
                            {job.targets.map((target) => <TargetStatusBadge key={`${target.platform}-${target.targetId ?? "default"}`} target={target} />)}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">{renderEngagement(item)}</TableCell>
                    <TableCell className="hidden align-top text-xs text-muted-foreground sm:table-cell">
                      {formatDate(item.post?.publishedAt ?? item.createdAt)}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <RowActionsMenu actions={rowActions(item)} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PaginationControls
        page={page}
        pageSize={pageSize}
        total={total}
        createPageUrl={createPageUrl}
      />

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        draftId={composeDraftId}
        onSuccess={() => router.refresh()}
        onSentToAgent={(info) => {
          setSentBanner(info);
          router.refresh();
        }}
      />
    </div>
  );
}

export function ContentListClient(props: ContentListClientProps) {
  return (
    <Suspense>
      <ContentListInner {...props} />
    </Suspense>
  );
}
