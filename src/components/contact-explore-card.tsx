"use client";

import { useEffect, useRef, useState } from "react";
import type { ContactExploreCard, ContactExplorePersona } from "@/lib/db/queries/contact-explore";
import { selectPrimaryIdentity } from "@/components/explore/explore-utils";
import { ExploreIdentityHeader } from "@/components/explore/explore-identity-header";
import { ExplorePersonaSection } from "@/components/explore/explore-persona-section";
import { ExploreTargetPlaybook } from "@/components/explore/explore-target-playbook";
import type { RelationshipGoal } from "@/lib/relationship-goals";
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

  async function handlePlaybookGoalChange(goal: RelationshipGoal) {
    try {
      await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relationshipGoal: goal,
          relationshipGoalStatus: "not_started",
        }),
      });
      setExplore((current) => ({
        ...current,
        contact: {
          ...current.contact,
          relationshipGoal: goal,
          relationshipGoalStatus: "not_started",
        },
      }));
    } catch {
      // Non-blocking
    }
  }

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

      if (!res.ok) {
        let errMessage = "Persona generation failed";
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody?.error) errMessage = errBody.error;
        } catch {
          // Fallback
        }
        if (generation !== generationRef.current) return;
        setError(errMessage);
        return;
      }

      const body = (await res.json()) as {
        error?: string;
        persona?: ContactExplorePersona;
      };
      if (generation !== generationRef.current) return;

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

  function handlePlaybookDispatched(status = "in_progress") {
    setExplore((current) => ({
      ...current,
      contact: {
        ...current.contact,
        relationshipGoalStatus: status,
      },
    }));
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

      {explore.persona.visibility === "shared" ? (
        <ExploreTargetPlaybook
          contact={{
            id: explore.contact.id,
            name: explore.contact.name,
            firstName: explore.contact.firstName,
            lastName: explore.contact.lastName,
            company: explore.contact.company,
            title: explore.contact.title,
            platform: primaryIdentity?.platform,
            platformHandle: primaryIdentity?.platformHandle,
            relationshipGoal: explore.contact.relationshipGoal,
            relationshipGoalStatus: explore.contact.relationshipGoalStatus,
          }}
          persona={explore.persona}
          onGoalChange={handlePlaybookGoalChange}
          onDispatched={handlePlaybookDispatched}
        />
      ) : null}

      <ExplorePlatformStats identities={explore.identities} />
      <ExploreNicheChips
        niches={nichesBeyondInterests(explore.niches, explore.persona.interests)}
      />
      <ExploreRecentPosts posts={explore.recentPosts} />
    </div>
  );
}
