"use client";

import type { ContactExploreCard } from "@/lib/db/queries/contact-explore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const platformLabels: Record<string, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  substack: "Substack",
};

function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

/** Platform handles are stored platform-formatted (@user, /in/name); render verbatim. */
export function formatPlatformHandle(handle: string): string {
  return handle;
}

interface ContactExploreCardProps {
  explore: ContactExploreCard;
}

export function ContactExploreCardView({ explore }: ContactExploreCardProps) {
  const { persona, identities, niches } = explore;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Persona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {persona.visibility === "absent" && (
            <p className="text-sm text-muted-foreground">No shared persona yet.</p>
          )}
          {persona.visibility === "local_only" && (
            <div className="space-y-2">
              <Badge variant="outline">Private persona</Badge>
              <p className="text-sm text-muted-foreground">
                A persona exists for this contact but is marked local-only and is not shown here.
              </p>
            </div>
          )}
          {persona.visibility === "shared" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {persona.archetype && <Badge variant="secondary">{persona.archetype}</Badge>}
                {persona.tone && (
                  <span className="text-sm text-muted-foreground">Tone: {persona.tone}</span>
                )}
                {persona.confidence != null && (
                  <span className="text-xs text-muted-foreground">
                    Confidence {(persona.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {persona.summary && <p className="text-sm">{persona.summary}</p>}
              {persona.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {persona.interests.map((interest) => (
                    <Badge key={interest} variant="outline">
                      {interest}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform stats</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {identities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No platform identities linked.</p>
          ) : (
            identities.map((identity) => (
              <div key={identity.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {platformLabels[identity.platform] ?? identity.platform}
                  </span>
                  {identity.platformHandle && (
                    <span className="text-xs text-muted-foreground">
                      {formatPlatformHandle(identity.platformHandle)}
                    </span>
                  )}
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
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Niches</CardTitle>
        </CardHeader>
        <CardContent>
          {niches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shared niche memberships yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {niches.map((niche) => (
                <a
                  key={niche.id}
                  href="#"
                  title="Niche detail coming soon"
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-muted"
                >
                  <span>{niche.name}</span>
                  {niche.weight != null && (
                    <span className="text-xs text-muted-foreground">
                      {(niche.weight * 100).toFixed(0)}%
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
