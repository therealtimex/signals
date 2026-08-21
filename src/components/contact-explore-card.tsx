"use client";

import { useEffect, useRef, useState } from "react";
import type { ContactExploreCard, ContactExplorePersona } from "@/lib/db/queries/contact-explore";
import { selectPrimaryIdentity } from "@/components/explore/explore-utils";
import { ExploreIdentityHeader } from "@/components/explore/explore-identity-header";
import { ExplorePersonaSection } from "@/components/explore/explore-persona-section";
import { ExplorePlatformStats } from "@/components/explore/explore-platform-stats";
import { ExploreNicheChips } from "@/components/explore/explore-niche-chips";
import { ExploreRecentPosts } from "@/components/explore/explore-recent-posts";
import { nichesBeyondInterests } from "@/components/explore/explore-format";
import { Card, CardContent } from "@/components/ui/card";

export {
  formatAccountAge,
  formatRelativeGeneratedAt,
} from "@/components/explore/explore-format";
export { formatPlatformHandle } from "@/lib/contact-identity-handle";

interface ContactExploreCardProps {
  contactId: string;
  explore: ContactExploreCard;
  showIdentityHeader?: boolean;
}

export function ContactExploreCardView({
  contactId,
  explore: initialExplore,
  showIdentityHeader = true,
}: ContactExploreCardProps) {
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

  const primaryIdentity = selectPrimaryIdentity(explore.identities);

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
      {showIdentityHeader ? (
        <Card>
          <CardContent className="pt-6">
            <ExploreIdentityHeader
              contact={explore.contact}
              primaryIdentity={primaryIdentity}
              relationship={explore.relationship}
              org={explore.org}
            />
          </CardContent>
        </Card>
      ) : null}

      <ExplorePersonaSection
        persona={explore.persona}
        generating={generating}
        error={error}
        onGenerate={handleGeneratePersona}
      />

      <ExplorePlatformStats identities={explore.identities} />
      <ExploreNicheChips
        niches={nichesBeyondInterests(explore.niches, explore.persona.interests)}
      />
      <ExploreRecentPosts posts={explore.recentPosts} />
    </div>
  );
}
