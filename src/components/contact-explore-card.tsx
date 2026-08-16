"use client";

import { useEffect, useRef, useState } from "react";
import type { ContactExploreCard, ContactExplorePersona } from "@/lib/db/queries/contact-explore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

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

export function formatRelativeGeneratedAt(
  unixSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 1_209_600) return `${Math.floor(diff / 86_400)}d ago`;
  if (diff < 2_592_000) return `${Math.floor(diff / 604_800)}w ago`;
  if (diff < 31_536_000) return `${Math.floor(diff / 2_592_000)}mo ago`;
  return `${Math.floor(diff / 31_536_000)}y ago`;
}

/** Platform handles are stored platform-formatted (@user, /in/name); render verbatim. */
export function formatPlatformHandle(handle: string): string {
  return handle;
}

interface ContactExploreCardProps {
  contactId: string;
  explore: ContactExploreCard;
}

export function ContactExploreCardView({ contactId, explore: initialExplore }: ContactExploreCardProps) {
  const [explore, setExplore] = useState(initialExplore);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setExplore(initialExplore);
    setError(null);
    setGenerating(false);
  }, [contactId, initialExplore]);

  const { persona, identities, niches } = explore;

  async function handleGeneratePersona(force: boolean) {
    const generation = generationRef.current;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/generate-persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (generation !== generationRef.current) return;

      const body = (await res.json()) as {
        error?: string;
        persona?: ContactExplorePersona;
      };
      if (generation !== generationRef.current) return;

      if (!res.ok) {
        setError(body.error ?? "Persona generation failed");
        return;
      }
      if (body.persona) {
        setExplore((current) => ({ ...current, persona: body.persona! }));
      }
    } catch {
      if (generation !== generationRef.current) return;
      setError("Persona generation failed");
    } finally {
      if (generation === generationRef.current) {
        setGenerating(false);
      }
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Persona</CardTitle>
          {persona.visibility === "shared" && persona.stale && (
            <Badge variant="destructive">Stale</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {persona.visibility === "absent" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No shared persona yet.</p>
              <Button
                onClick={() => handleGeneratePersona(false)}
                disabled={generating}
              >
                {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate persona
              </Button>
            </div>
          )}
          {persona.visibility === "local_only" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="space-y-2"
                    title="This contact has a private persona. Re-scope it before generating a shared one."
                  >
                    <Badge variant="outline">Private persona</Badge>
                    <p className="text-sm text-muted-foreground">
                      A persona exists for this contact but is marked local-only and is not shown here.
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  This contact has a private persona. Re-scope it before generating a shared one.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {persona.visibility === "shared" && (
            <div className="space-y-3">
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
                {persona.generatedAt != null && (
                  <p className="text-xs text-muted-foreground">
                    Generated {formatRelativeGeneratedAt(persona.generatedAt)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {persona.stale ? (
                  <Button
                    onClick={() => handleGeneratePersona(false)}
                    disabled={generating}
                  >
                    {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Refresh persona
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => handleGeneratePersona(true)}
                    disabled={generating}
                  >
                    {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Regenerate
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
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
