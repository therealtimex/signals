import { notFound } from "next/navigation";
import Link from "next/link";
import { getContentItem, getThreadItems } from "@/lib/db/queries/content";
import { getContentGtmContext } from "@/lib/db/queries/content-gtm-context";
import { WindTunnelSection } from "@/components/wind-tunnel-section";
import { listEngagementsByContentPost } from "@/lib/db/queries/engagements";
import { getPlatformAccountByPlatform } from "@/lib/db/queries/platform-accounts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Heart, MessageCircle, Repeat2, Quote } from "lucide-react";
import { EngagementActions } from "./engagement-actions";

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

  const snapshot = item.post?.engagementSnapshot
    ? JSON.parse(item.post.engagementSnapshot)
    : null;

  // Check if X account is connected (for engagement actions)
  const xAccount = getPlatformAccountByPlatform("x");
  const canEngage = !!xAccount && xAccount.status === "active" && !!item.post?.platformPostId;

  // Get engagement history for this post
  const engagementHistory = item.post
    ? listEngagementsByContentPost(item.post.id)
    : [];

  // Get thread context if this item belongs to a thread
  const threadItems = item.threadId ? getThreadItems(item.threadId) : [];
  const isThread = threadItems.length > 1;
  const gtm = getContentGtmContext(id)!;

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
          {/* Header: type badges + date */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
                <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                  draft
                </Badge>
              )}
              {isThread && (
                <Badge variant="outline">
                  Thread ({threadItems.length} tweets)
                </Badge>
              )}
            </div>
            {item.post?.platformUrl && (
              <Button variant="ghost" size="sm" asChild>
                <a
                  href={item.post.platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-1 h-4 w-4" />
                  View on X
                </a>
              </Button>
            )}
          </div>

          {/* Title (if present) */}
          {item.title && (
            <h2 className="text-lg font-semibold">{item.title}</h2>
          )}

          {/* Tweet body */}
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {item.body ?? "No content"}
          </div>

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            {formatDate(item.post?.publishedAt ?? item.createdAt)}
          </p>

          {/* Engagement metrics */}
          {snapshot && (
            <div className="flex items-center gap-6 pt-2 border-t text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5" title="Likes">
                <Heart className="h-4 w-4" />
                {snapshot.likes ?? 0}
              </span>
              <span className="flex items-center gap-1.5" title="Replies">
                <MessageCircle className="h-4 w-4" />
                {snapshot.replies ?? 0}
              </span>
              <span className="flex items-center gap-1.5" title="Retweets">
                <Repeat2 className="h-4 w-4" />
                {snapshot.retweets ?? 0}
              </span>
              <span className="flex items-center gap-1.5" title="Quotes">
                <Quote className="h-4 w-4" />
                {snapshot.quotes ?? 0}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thread context */}
      {isThread && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium mb-3">Thread ({threadItems.length} tweets)</h3>
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

                    {/* Tweet content */}
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
