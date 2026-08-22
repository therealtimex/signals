"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Heart, Repeat2, MessageCircle, Loader2, Send } from "lucide-react";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { Engagement } from "@/lib/db/types";

interface EngagementActionsProps {
  tweetId: string;
  contentPostId?: string | null;
  engagementHistory: Engagement[];
}

type EngageAction = "like" | "unlike" | "retweet" | "unretweet" | "reply";

export function EngagementActions({
  tweetId,
  contentPostId,
  engagementHistory,
}: EngagementActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<EngageAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");

  // Determine initial toggle state from engagement history
  const hasLiked = engagementHistory.some(
    (e) => e.engagementType === "like" && e.source === "manual"
  );
  const hasRetweeted = engagementHistory.some(
    (e) => e.engagementType === "retweet" && e.source === "manual"
  );

  const [liked, setLiked] = useState(hasLiked);
  const [retweeted, setRetweeted] = useState(hasRetweeted);

  async function handleEngage(action: EngageAction, text?: string) {
    setLoading(action);
    setError(null);

    try {
      const res = await fetch("/api/platforms/x/engage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, tweetId, contentPostId, text }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }

      // Update optimistic state
      if (action === "like") setLiked(true);
      if (action === "unlike") setLiked(false);
      if (action === "retweet") setRetweeted(true);
      if (action === "unretweet") setRetweeted(false);
      if (action === "reply") {
        setReplyText("");
        setShowReply(false);
      }

      // Refresh to update engagement history
      router.refresh();
    } catch {
      setError("Action failed. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h3 className="text-sm font-medium">Actions</h3>

        <div className="flex items-center gap-2">
          {/* Like / Unlike */}
          <Button
            variant={liked ? "default" : "outline"}
            size="sm"
            disabled={loading !== null}
            onClick={() => handleEngage(liked ? "unlike" : "like")}
          >
            {loading === "like" || loading === "unlike" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Heart
                className={`mr-1 h-4 w-4 ${liked ? "fill-current" : ""}`}
              />
            )}
            {liked ? "Liked" : "Like"}
          </Button>

          {/* Retweet / Unretweet */}
          <Button
            variant={retweeted ? "default" : "outline"}
            size="sm"
            disabled={loading !== null}
            onClick={() => handleEngage(retweeted ? "unretweet" : "retweet")}
          >
            {loading === "retweet" || loading === "unretweet" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Repeat2 className="mr-1 h-4 w-4" />
            )}
            {retweeted ? "Retweeted" : "Retweet"}
          </Button>

          {/* Reply toggle */}
          <Button
            variant={showReply ? "default" : "outline"}
            size="sm"
            disabled={loading !== null}
            onClick={() => setShowReply(!showReply)}
          >
            <MessageCircle className="mr-1 h-4 w-4" />
            Reply
          </Button>
        </div>

        {/* Reply input */}
        {showReply && (
          <div className="space-y-2">
            <Textarea
              placeholder="Write your reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {replyText.length}/280
              </span>
              <Button
                size="sm"
                disabled={!replyText.trim() || replyText.length > 280 || loading !== null}
                onClick={() => handleEngage("reply", replyText)}
              >
                {loading === "reply" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                Send Reply
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <FeedbackBanner tone="danger">{error}</FeedbackBanner>
        )}
      </CardContent>
    </Card>
  );
}
