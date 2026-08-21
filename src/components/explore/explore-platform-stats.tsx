import type { ContactExploreIdentity } from "@/lib/db/queries/contact-explore";
import {
  formatAccountAge,
  formatCount,
  hasAudienceMetrics,
  platformLabels,
} from "@/components/explore/explore-format";
import { ExplorePlatformHandle } from "@/components/explore/explore-platform-handle";
import { PlatformMark } from "@/components/platform-mark";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ExplorePlatformStatsProps = {
  identities: ContactExploreIdentity[];
};

export function ExplorePlatformStats({ identities }: ExplorePlatformStatsProps) {
  if (identities.length === 0) return null;

  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {identities.map((identity) => {
          const label = platformLabels[identity.platform] ?? identity.platform;
          const accountAge =
            identity.platformCreatedAt != null
              ? formatAccountAge(identity.platformCreatedAt, label)
              : null;
          const showMetrics = hasAudienceMetrics(identity);
          return (
            <li key={identity.id} className="flex items-start gap-3 px-4 py-3">
              <PlatformMark platform={identity.platform} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{label}</span>
                  {identity.isVerified ? (
                    <Badge variant="secondary" className="text-xs">
                      Verified
                    </Badge>
                  ) : null}
                  {identity.platformHandle ? (
                    <ExplorePlatformHandle
                      platform={identity.platform}
                      handle={identity.platformHandle}
                      platformUrl={identity.platformUrl}
                    />
                  ) : null}
                </div>
                {showMetrics ? (
                  <p className="text-xs text-muted-foreground">
                    {[
                      identity.followersCount != null
                        ? `${formatCount(identity.followersCount)} followers`
                        : null,
                      identity.followingCount != null
                        ? `${formatCount(identity.followingCount)} following`
                        : null,
                      identity.postsCount != null ? `${formatCount(identity.postsCount)} posts` : null,
                      identity.listedCount != null
                        ? `${formatCount(identity.listedCount)} listed`
                        : null,
                      identity.engagementRate != null
                        ? `${(identity.engagementRate * 100).toFixed(2)}% engagement`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {accountAge ? <p className="text-xs text-muted-foreground">{accountAge}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
