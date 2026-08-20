import { Heart, MessageCircle, Quote, Repeat2, Share2, type LucideIcon } from "lucide-react";
import {
  getEngagementMetrics,
  type EngagementMetricKey,
} from "@/lib/platforms/content-platform";
import { likeIcon } from "@/lib/platforms/platform-icons";
import { cn } from "@/lib/utils";

const METRIC_ICONS: Record<EngagementMetricKey, LucideIcon> = {
  likes: Heart,
  replies: MessageCircle,
  comments: MessageCircle,
  retweets: Repeat2,
  quotes: Quote,
  shares: Share2,
};

function metricIcon(key: EngagementMetricKey, platform: string | null | undefined): LucideIcon {
  if (key === "likes") return likeIcon(platform);
  return METRIC_ICONS[key];
}

interface EngagementMetricsProps {
  snapshot: Record<string, unknown> | null | undefined;
  platform: string | null | undefined;
  /** "sm" for dense table rows, "md" for the content detail card. */
  size?: "sm" | "md";
  className?: string;
}

/** Engagement counters for a content post, labelled for the platform it was published to. */
export function EngagementMetrics({
  snapshot,
  platform,
  size = "sm",
  className,
}: EngagementMetricsProps) {
  const metrics = getEngagementMetrics(platform, snapshot);
  if (metrics.length === 0) return null;

  const dense = size === "sm";

  return (
    <div
      className={cn(
        "flex items-center text-muted-foreground",
        dense ? "gap-3 text-xs" : "gap-6 text-sm",
        className
      )}
    >
      {metrics.map(({ key, label, value }) => {
        const Icon = metricIcon(key, platform);
        return (
          <span
            key={key}
            className={cn("flex items-center", dense ? "gap-1" : "gap-1.5")}
            title={label}
            aria-label={`${label}: ${value}`}
          >
            <Icon className={dense ? "size-3" : "size-4"} aria-hidden="true" />
            {value}
          </span>
        );
      })}
    </div>
  );
}
