"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, Suspense, useMemo, useEffect, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Heart,
  MessageCircle,
  Repeat2,
  Quote,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  PenSquare,
  Pencil,
  Share2,
  ThumbsUp,
  Clock,
  Loader2,
  AlertCircle,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ComposeDialog } from "@/components/compose-dialog";
import { PaginationControls } from "@/components/pagination-controls";
import { usePublishJobs } from "@/hooks/use-publish-jobs";
import type { ContentItemWithPost } from "@/lib/db/types";
import type { PublishJobTarget } from "@/lib/publish/types";
import { cn } from "@/lib/utils";

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

const STATUS_BADGE: Record<
  string,
  { label: string; className: string; icon?: ReactNode }
> = {
  draft: {
    label: "draft",
    className: "border-yellow-500 text-yellow-600",
  },
  queued: {
    label: "queued",
    className: "border-muted-foreground/40 text-muted-foreground",
    icon: <Clock className="h-3 w-3" />,
  },
  publishing: {
    label: "publishing",
    className: "border-blue-500 text-blue-600",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  published: {
    label: "published",
    className: "border-green-600 text-green-700",
  },
  failed: {
    label: "failed",
    className: "border-red-500 text-red-600",
    icon: <AlertCircle className="h-3 w-3" />,
  },
};

const TARGET_STATUS_COLOR: Record<string, string> = {
  pending: "text-muted-foreground",
  publishing: "text-blue-500",
  published: "text-green-600",
  failed: "text-red-500",
  skipped: "text-muted-foreground",
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

function getItemPlatform(item: ContentItemWithPost): string | null {
  if (item.platformTarget) return item.platformTarget.split(",")[0]?.trim() ?? null;
  return null;
}

function PlatformGlyphs({ targets }: { targets: PublishJobTarget[] }) {
  if (targets.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {targets.map((t) => (
        <span
          key={t.platform}
          title={t.error || t.platformUrl || t.status}
          className={cn("text-[10px] font-semibold uppercase", TARGET_STATUS_COLOR[t.status])}
        >
          {t.platform === "linkedin" ? "in" : "𝕏"}
        </span>
      ))}
    </div>
  );
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

  useEffect(() => {
    checkTerminalTransitions(() => router.refresh());
  }, [checkTerminalTransitions, router, jobsByItemId]);

  const threadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of content) {
      if (item.threadId) {
        counts.set(item.threadId, (counts.get(item.threadId) ?? 0) + 1);
      }
    }
    return counts;
  }, [content]);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === "origin") {
        if (value === "drafts") {
          params.delete("origin");
          params.set("status", "draft");
        } else {
          params.delete("status");
          if (value && value !== "all") {
            params.set(key, value);
          } else {
            params.delete(key);
          }
        }
      } else if (key === "platform") {
        if (value && value !== "all") {
          params.set("platform", value);
        } else {
          params.delete("platform");
        }
      }
      params.delete("page");
      router.push(`/dashboard/content?${params.toString()}`);
    },
    [router, searchParams]
  );

  const createPageUrl = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (p > 1) {
        params.set("page", String(p));
      } else {
        params.delete("page");
      }
      return `/dashboard/content?${params.toString()}`;
    },
    [searchParams]
  );

  async function openThread(jobId: string) {
    setActionLoading(`open-${jobId}`);
    try {
      const res = await fetch(`/api/content/publish-jobs/${jobId}/open-thread`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.threadPath) {
        setSentBanner({ jobId, threadPath: data.threadPath });
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function retryPublish(itemId: string) {
    const job = jobsByItemId[itemId];
    if (!job?.payload) return;
    setActionLoading(`retry-${itemId}`);
    try {
      const res = await fetch("/api/content/send-to-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentItemId: itemId,
          platforms: job.payload.platforms,
          targets: job.targets
            .filter((target) => target.targetId)
            .map((target) => ({ targetId: target.targetId })),
          text: job.payload.text,
          mediaAssetIds: job.payload.mediaAssetIds?.length
            ? job.payload.mediaAssetIds
            : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const threadPath =
          data.rtxWorkspaceSlug && data.rtxThreadSlug
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

  function formatDate(unix: number | null | undefined): string {
    if (!unix) return "—";
    return new Date(unix * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function truncate(text: string | null | undefined, len: number): string {
    if (!text) return "—";
    return text.length > len ? text.slice(0, len) + "..." : text;
  }

  function renderStatusBadges(item: ContentItemWithPost) {
    const status = item.status ?? "draft";
    const badge = STATUS_BADGE[status];
    const job = jobsByItemId[item.id];

    return (
      <div className="flex flex-col gap-1">
        {badge && (
          <Badge
            variant="outline"
            className={cn("text-xs w-fit gap-1", badge.className, job?.stale && "border-amber-500")}
          >
            {badge.icon}
            {badge.label}
          </Badge>
        )}
        {job?.targets && job.targets.length > 1 && <PlatformGlyphs targets={job.targets} />}
        {job?.stale && (
          <span className="text-[10px] text-amber-600">
            Check the thread — the agent may need input
          </span>
        )}
      </div>
    );
  }

  function renderRowActions(item: ContentItemWithPost) {
    const job = jobsByItemId[item.id];
    const loading = actionLoading?.includes(item.id) || actionLoading?.includes(job?.id ?? "");

    if (item.status === "draft") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setComposeDraftId(item.id);
            setComposeOpen(true);
          }}
        >
          <Pencil className="mr-1.5 h-3 w-3" />
          Edit
        </Button>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {job?.rtxThreadSlug && job.id && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              void openThread(job.id);
            }}
          >
            <MessageSquare className="mr-1 h-3 w-3" />
            Open thread
          </Button>
        )}
        {item.status === "failed" && job?.payload && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              void retryPublish(item.id);
            }}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        )}
        {job?.stale && job.id && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 text-amber-700"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              void markJobFailed(job.id);
            }}
          >
            Mark failed
          </Button>
        )}
      </div>
    );
  }

  function renderEngagement(item: ContentItemWithPost) {
    if (item.status === "draft" || item.status === "queued" || item.status === "publishing") {
      return renderRowActions(item);
    }

    if (item.status === "failed") {
      return renderRowActions(item);
    }

    const snapshot = item.post?.engagementSnapshot
      ? JSON.parse(item.post.engagementSnapshot)
      : null;

    const actions = renderRowActions(item);

    if (!snapshot) {
      return actions ?? <span className="text-muted-foreground text-xs">—</span>;
    }

    const platform = getItemPlatform(item);

    const metrics =
      platform === "linkedin" ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Likes">
            <ThumbsUp className="h-3 w-3" />
            {snapshot.likes ?? 0}
          </span>
          <span className="flex items-center gap-1" title="Comments">
            <MessageCircle className="h-3 w-3" />
            {snapshot.comments ?? 0}
          </span>
          <span className="flex items-center gap-1" title="Shares">
            <Share2 className="h-3 w-3" />
            {snapshot.shares ?? 0}
          </span>
        </div>
      ) : platform === "gmail" ? null : (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Likes">
            <Heart className="h-3 w-3" />
            {snapshot.likes ?? 0}
          </span>
          <span className="flex items-center gap-1" title="Replies">
            <MessageCircle className="h-3 w-3" />
            {snapshot.replies ?? 0}
          </span>
          <span className="flex items-center gap-1" title="Retweets">
            <Repeat2 className="h-3 w-3" />
            {snapshot.retweets ?? 0}
          </span>
          <span className="flex items-center gap-1" title="Quotes">
            <Quote className="h-3 w-3" />
            {snapshot.quotes ?? 0}
          </span>
        </div>
      );

    return (
      <div className="flex flex-col gap-2">
        {metrics}
        {actions}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sentBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          <span>Sent to agent — open the thread to follow progress.</span>
          <div className="flex items-center gap-2 shrink-0">
            {sentBanner.threadPath && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => void openThread(sentBanner.jobId)}
              >
                Open thread
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setSentBanner(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <Tabs
          defaultValue={currentStatus === "draft" ? "drafts" : (currentOrigin ?? "all")}
          onValueChange={(v) => updateParams("origin", v)}
        >
          <TabsList>
            {originFilters.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          size="sm"
          onClick={() => {
            setComposeDraftId(null);
            setComposeOpen(true);
          }}
        >
          <PenSquare className="mr-2 h-4 w-4" />
          Compose
        </Button>
      </div>

      <div className="flex items-center gap-1">
        {platformFilters.map((f) => (
          <Button
            key={f.value}
            variant={(currentPlatform ?? "all") === f.value ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => updateParams("platform", f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {content.length === 0 ? (
        <Card className="border-border/50">
          <EmptyState
            icon={FileText}
            title="No content yet"
            description="Create new content with the Compose button, or sync posts from the Automation tab."
          />
        </Card>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="max-w-0 overflow-hidden">Content</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-36">Engagement</TableHead>
                <TableHead className="w-32">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {content.map((item) => (
                <TableRow
                  key={item.id}
                  className={cn(
                    "hover:bg-accent/30 transition-colors cursor-pointer",
                    jobsByItemId[item.id]?.stale && "bg-amber-50/50 dark:bg-amber-950/20"
                  )}
                  onClick={() => router.push(`/dashboard/content/${item.id}`)}
                >
                  <TableCell className="max-w-0 overflow-hidden">
                    <div className="space-y-1">
                      {item.title && (
                        <p className="font-medium text-sm">{truncate(item.title, 60)}</p>
                      )}
                      <div className="text-sm text-muted-foreground break-words">
                        {expandedItems.has(item.id) ? (
                          <p className="whitespace-pre-wrap">{item.body ?? "—"}</p>
                        ) : (
                          <p>{truncate(item.body, 120)}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {item.body && item.body.length > 120 && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedItems((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) {
                                    next.delete(item.id);
                                  } else {
                                    next.add(item.id);
                                  }
                                  return next;
                                });
                              }}
                            >
                              {expandedItems.has(item.id) ? (
                                <>
                                  <ChevronUp className="h-3 w-3" />
                                  Show less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3" />
                                  Show more
                                </>
                              )}
                            </button>
                          )}
                          {item.post?.platformUrl && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                              <a
                                href={item.post.platformUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View on platform"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="secondary" className="text-xs w-fit">
                        {contentTypeLabels[item.contentType] ?? item.contentType}
                      </Badge>
                      {item.origin && (
                        <Badge variant="outline" className="text-xs w-fit">
                          {item.origin}
                        </Badge>
                      )}
                      {item.threadId && threadCounts.get(item.threadId)! > 1 && (
                        <Badge variant="outline" className="text-xs w-fit">
                          Thread ({threadCounts.get(item.threadId)})
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{renderStatusBadges(item)}</TableCell>
                  <TableCell>{renderEngagement(item)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(item.post?.publishedAt ?? item.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
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
