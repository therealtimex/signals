import { notFound } from "next/navigation";
import Link from "next/link";
import { getContentItem, getThreadItems } from "@/lib/db/queries/content";
import { getContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { getLatestPublishJobForContentItem } from "@/lib/db/queries/publish-jobs";
import { WindTunnelSection } from "@/components/wind-tunnel-section";
import { listEngagementsByContentPost } from "@/lib/db/queries/engagements";
import {
  getPlatformAccountById,
  getPlatformAccountByPlatform,
} from "@/lib/db/queries/platform-accounts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { EngagementMetrics } from "@/components/engagement-metrics";
import {
  getPlatformLabel,
  parseEngagementSnapshot,
  resolveContentPlatform,
  resolveContentPostUrl,
} from "@/lib/platforms/content-platform";
import { EngagementActions } from "./engagement-actions";
import { ContentStatusBadge } from "@/components/content-status-badge";

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

function formatDate(unix: number | null | undefined): string {
  if (!unix) return "Unknown date";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = getContentItem(id);

  if (!item) {
    notFound();
  }

  const snapshot = parseEngagementSnapshot(item.post?.engagementSnapshot);

  // Which platform this content actually lives on — drives labels, metrics and actions
  const postAccount = item.post ? getPlatformAccountById(item.post.platformAccountId) : undefined;
  const platform = resolveContentPlatform(item, postAccount?.platform);
  const isX = platform === "x";
  const threadUnit = isX ? "tweets" : "posts";

  // Engagement actions are X-only for now (see /api/platforms/x/engage)
  const xAccount = isX ? getPlatformAccountByPlatform("x") : undefined;
  const canEngage = !!xAccount && xAccount.status === "active" && !!item.post?.platformPostId;

  // Get engagement history for this post
  const engagementHistory = item.post
    ? listEngagementsByContentPost(item.post.id)
    : [];

  // Get thread context if this item belongs to a thread
  const threadItems = item.threadId ? getThreadItems(item.threadId) : [];
  const isThread = threadItems.length > 1;
  const gtm = getContentGtmContext(id)!;
  const publishJob = getLatestPublishJobForContentItem(id);
  const publishedTarget = publishJob?.targetsParsed.find((target) => target.status === "published");
  const platformUrl =
    resolveContentPostUrl(platform, item.post) ??
    resolveContentPostUrl(publishedTarget?.platform ?? platform, publishedTarget);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/content">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Content
          </Link>
        </Button>
      </div>

      {/* Main content card */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Header: type badges + platform link (wraps on narrow viewports) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {contentTypeLabels[item.contentType] ?? item.contentType}
              </Badge>
              {item.origin && (
                <Badge variant="outline">{item.origin}</Badge>
              )}
              {item.direction && (
                <Badge variant="outline">{item.direction}</Badge>
              )}
              {item.status === "draft" && (
                <ContentStatusBadge status={item.status} />
              )}
              {isThread && (
                <Badge variant="outline">
                  Thread ({threadItems.length} {threadUnit})
                </Badge>
              )}
            </div>
            {platformUrl && (
              <Button variant="ghost" size="sm" className="shrink-0" asChild>
                <a
                  href={platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1 h-4 w-4" />
                  View on {getPlatformLabel(platform)}
                </a>
              </Button>
            )}
          </div>

          {/* Title (if present) */}
          {item.title && (
            <h2 className="text-lg font-semibold">{item.title}</h2>
          )}

          {/* Body */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {item.body ?? "No content"}
          </div>

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            {formatDate(item.post?.publishedAt ?? item.createdAt)}
          </p>

          {/* Engagement metrics */}
          <EngagementMetrics
            snapshot={snapshot}
            platform={platform}
            size="md"
            className="pt-2 border-t"
          />
        </CardContent>
      </Card>

      {/* Thread context */}
      {isThread && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium mb-3">Thread ({threadItems.length} {threadUnit})</h3>
            <div className="space-y-0">
              {threadItems.map((ti, idx) => {
                const isCurrent = ti.id === item.id;
                return (
                  <div key={ti.id} className="flex gap-3">
                    {/* Vertical connector */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isCurrent ? "bg-primary" : "bg-muted-foreground/30"
                        }`}
                      />
                      {idx < threadItems.length - 1 && (
                        <div className="w-0.5 flex-1 bg-muted-foreground/20 min-h-4" />
                      )}
                    </div>

                    {/* Item content */}
                    {isCurrent ? (
                      <div className="pb-3 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {ti.body
                            ? ti.body.length > 100
                              ? ti.body.slice(0, 100) + "..."
                              : ti.body
                            : "No content"}
                        </p>
                        <Badge variant="secondary" className="text-xs mt-1">
                          Current
                        </Badge>
                      </div>
                    ) : (
                      <Link
                        href={`/dashboard/content/${ti.id}`}
                        className="pb-3 flex-1 group"
                      >
                        <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                          {ti.body
                            ? ti.body.length > 100
                              ? ti.body.slice(0, 100) + "..."
                              : ti.body
                            : "No content"}
                        </p>
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Engagement action bar */}
      {canEngage && item.post && (
        <EngagementActions
          tweetId={item.post.platformPostId!}
          contentPostId={item.post.id}
          engagementHistory={engagementHistory}
        />
      )}

      {/* Engagement history */}
      {engagementHistory.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium mb-3">Your Activity</h3>
            <div className="space-y-2">
              {engagementHistory.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between text-sm text-muted-foreground py-1 border-b last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {e.engagementType}
                    </Badge>
                    {e.content && (
                      <span className="truncate max-w-xs">{e.content}</span>
                    )}
                  </div>
                  <span className="text-xs">
                    {formatDate(e.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <WindTunnelSection gtm={gtm} />
    </div>
  );
}
