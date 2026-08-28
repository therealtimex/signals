import type { RelationshipStrength, RelationshipStrengthBand } from "./relationship-strength";

export type IntroPath = {
  target: { contactId: string; name: string; title: string | null };
  via: { contactId: string; name: string }[];
  score: number;
  band: RelationshipStrengthBand;
  explanation: string;
  nextAction: {
    kind: "reach_out" | "re_engage" | "ask_intro" | "run_snowball" | "link_people";
    label: string;
    href?: string;
  };
};

export type IntroTarget = {
  contactId: string;
  name: string;
  title: string | null;
  strength: RelationshipStrength;
  direct: boolean;
};

export type SecondDegreeConnection = {
  targetContactId: string;
  via: { contactId: string; name: string; strength: RelationshipStrength };
  connection: "connected" | "mutual_follows" | "follows";
};

export function buildIntroductionPaths(
  targets: IntroTarget[],
  secondDegree: SecondDegreeConnection[],
  limit = 5,
): { paths: IntroPath[]; coverage: "direct" | "second_degree" | "none" } {
  const best = new Map<string, IntroPath>();
  for (const target of targets) {
    if (!target.direct) continue;
    const score = target.strength.score ?? 0;
    const strong = target.strength.band === "strong";
    best.set(target.contactId, {
      target: { contactId: target.contactId, name: target.name, title: target.title },
      via: [],
      score,
      band: target.strength.band,
      explanation: `You're connected to ${target.name} (${target.strength.band === "unknown" ? "strength unknown" : `${target.strength.band} — ${score}/100`})`,
      nextAction: {
        kind: strong ? "reach_out" : "re_engage",
        label: strong ? "Reach out" : "Re-engage",
        href: `/dashboard/contacts/${target.contactId}`,
      },
    });
  }

  for (const connection of secondDegree) {
    if (best.has(connection.targetContactId)) continue;
    const target = targets.find((candidate) => candidate.contactId === connection.targetContactId);
    if (!target) continue;
    const factor = connection.connection === "connected" ? 0.8 : connection.connection === "mutual_follows" ? 0.7 : 0.5;
    const score = Math.round((connection.via.strength.score ?? 0) * factor);
    const candidate: IntroPath = {
      target: { contactId: target.contactId, name: target.name, title: target.title },
      via: [{ contactId: connection.via.contactId, name: connection.via.name }],
      score,
      band: target.strength.band,
      explanation: `Ask ${connection.via.name} — they can connect you with ${target.name}`,
      nextAction: { kind: "ask_intro", label: `Ask ${connection.via.name} for an introduction` },
    };
    const existing = best.get(target.contactId);
    if (!existing || candidate.score > existing.score) best.set(target.contactId, candidate);
  }

  const paths = [...best.values()]
    .sort((a, b) => b.score - a.score || a.target.name.localeCompare(b.target.name))
    .slice(0, limit);
  return {
    paths,
    coverage: paths.some((path) => path.via.length === 0)
      ? "direct"
      : paths.length > 0
        ? "second_degree"
        : "none",
  };
}
