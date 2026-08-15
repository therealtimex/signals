import type { SimulationRun } from "@/lib/db/types";

export function findProjectionSourceRunId(runs: SimulationRun[]): string | null {
  const completed = runs.filter((run) => run.status === "completed");
  if (completed.length === 0) return null;

  let best = completed[0]!;
  for (const run of completed.slice(1)) {
    const bestCompleted = best.completedAt ?? 0;
    const runCompleted = run.completedAt ?? 0;
    if (runCompleted > bestCompleted) {
      best = run;
      continue;
    }
    if (runCompleted < bestCompleted) continue;

    // Match projectVariantFromRunIfLatest: completedAt desc, then id desc (Phase 3 §6).
    if (run.id > best.id) {
      best = run;
    }
  }

  return best.id;
}

export function summarizeAgentGrounding(grounding: Record<string, unknown>): {
  name: string;
  headline: string | null;
} {
  const contact = grounding.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const name = (contact as { name?: string }).name;
    if (typeof name === "string" && name.trim()) {
      return { name, headline: personaHeadline(grounding) ?? identityBio(grounding) };
    }
  }

  const identities = grounding.identities;
  if (Array.isArray(identities) && identities.length > 0) {
    const first = identities[0];
    if (first && typeof first === "object") {
      const identity = first as {
        displayName?: string | null;
        platformHandle?: string | null;
        bio?: string | null;
      };
      const identityName = identity.displayName ?? identity.platformHandle;
      if (typeof identityName === "string" && identityName.trim()) {
        return {
          name: identityName,
          headline: personaHeadline(grounding) ?? identityBio(grounding),
        };
      }
    }
  }

  return {
    name: "Agent",
    headline: personaHeadline(grounding) ?? identityBio(grounding),
  };
}

function personaHeadline(grounding: Record<string, unknown>): string | null {
  const persona = grounding.persona;
  if (!persona || typeof persona !== "object" || Array.isArray(persona)) return null;
  const archetype = (persona as { archetype?: string | null }).archetype;
  const tone = (persona as { tone?: string | null }).tone;
  const parts = [
    typeof archetype === "string" && archetype.trim() ? archetype : null,
    typeof tone === "string" && tone.trim() ? tone : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function identityBio(grounding: Record<string, unknown>): string | null {
  const identities = grounding.identities;
  if (!Array.isArray(identities) || identities.length === 0) return null;
  const first = identities[0];
  if (!first || typeof first !== "object") return null;
  const bio = (first as { bio?: string | null }).bio;
  return typeof bio === "string" && bio.trim() ? bio : null;
}
