import type { ContactExploreIdentity } from "@/lib/db/queries/contact-explore";
import {
  formatAccountAge,
  formatCount,
  platformLabels,
} from "@/components/explore/explore-format";
import { ExplorePlatformHandle } from "@/components/explore/explore-platform-handle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ExplorePlatformStatsProps = {
  identities: ContactExploreIdentity[];
};

export function ExplorePlatformStats({ identities }: ExplorePlatformStatsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Platform stats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {identities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No platform identities linked.</p>
        ) : (
          identities.map((identity) => {
            const platformLabel = platformLabels[identity.platform] ?? identity.platform;
            const accountAge =
              identity.platformCreatedAt != null
                ? formatAccountAge(identity.platformCreatedAt, platformLabel)
                : null;
            return (
              <div key={identity.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  {identity.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={identity.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{platformLabel}</span>
                      {identity.isVerified && (
                        <Badge variant="secondary" className="text-xs">
                          Verified
                        </Badge>
                      )}
                      {identity.platformHandle && (
                        <ExplorePlatformHandle
                          platform={identity.platform}
                          handle={identity.platformHandle}
                          platformUrl={identity.platformUrl}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>Followers: {formatCount(identity.followersCount)}</span>
                  <span>Following: {formatCount(identity.followingCount)}</span>
                  <span>Posts: {formatCount(identity.postsCount)}</span>
                  <span>Listed: {formatCount(identity.listedCount)}</span>
                </div>
                {identity.engagementRate != null && (
                  <p className="text-xs text-muted-foreground">
                    Engagement rate: {(identity.engagementRate * 100).toFixed(2)}%
                  </p>
                )}
                {accountAge && <p className="text-xs text-muted-foreground">{accountAge}</p>}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
