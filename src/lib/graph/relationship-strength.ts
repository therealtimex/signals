export type RelationshipStrengthBand = "unknown" | "weak" | "moderate" | "strong";

export type RelationshipStrengthComponent = {
  key: "warmth" | "recency" | "frequency" | "reciprocity" | "connection";
  label: string;
  value: number;
  weight: number;
  detail: string;
};

export type RelationshipStrength = {
  score: number | null;
  band: RelationshipStrengthBand;
  components: RelationshipStrengthComponent[];
  computedAt: number;
};

export type RelationshipInteractionInput = {
  occurredAt: number;
  direction: "inbound" | "outbound" | "mutual" | null;
  communication: boolean;
  meaningful: boolean;
};

export function relationshipBand(score: number | null): RelationshipStrengthBand {
  if (score === null) return "unknown";
  if (score < 30) return "weak";
  if (score < 60) return "moderate";
  return "strong";
}

export function calculateRelationshipStrength(input: {
  warmth?: number | null;
  interactions?: RelationshipInteractionInput[];
  connection?: "connected" | "mutual_follows" | "follows" | null;
  now?: number;
}): RelationshipStrength {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const components: RelationshipStrengthComponent[] = [];

  if (input.warmth != null) {
    const value = Math.max(0, Math.min(100, Math.round(input.warmth)));
    components.push({
      key: "warmth",
      label: "Your rating",
      value,
      weight: 0.4,
      detail: `You rated this relationship ${value}/100`,
    });
  }

  const relevant = (input.interactions ?? []).filter(
    (interaction) => interaction.communication || interaction.meaningful,
  );
  if (relevant.length > 0) {
    const latest = Math.max(...relevant.map((interaction) => interaction.occurredAt));
    const days = Math.max(0, Math.floor((now - latest) / 86_400));
    const recency = days <= 7 ? 100 : days <= 30 ? 80 : days <= 90 ? 50 : days <= 365 ? 20 : 0;
    components.push({
      key: "recency",
      label: "Recent contact",
      value: recency,
      weight: 0.25,
      detail: `Last meaningful interaction ${days} ${days === 1 ? "day" : "days"} ago`,
    });

    const cutoff = now - 180 * 86_400;
    const recentCommunication = relevant.filter(
      (interaction) => interaction.communication && interaction.occurredAt >= cutoff,
    );
    components.push({
      key: "frequency",
      label: "Interaction frequency",
      value: Math.min(100, recentCommunication.length * 10),
      weight: 0.15,
      detail: `${recentCommunication.length} communication ${recentCommunication.length === 1 ? "interaction" : "interactions"} in 180 days`,
    });
    const inbound = recentCommunication.some((interaction) => interaction.direction === "inbound");
    components.push({
      key: "reciprocity",
      label: "They reach out",
      value: inbound ? 100 : 0,
      weight: 0.1,
      detail: inbound ? "They reached out in the last 180 days" : "No inbound contact in 180 days",
    });
  }

  if (input.connection) {
    const connection = {
      connected: { value: 100, detail: "Directly connected" },
      mutual_follows: { value: 70, detail: "You follow each other" },
      follows: { value: 40, detail: "One-way social connection" },
    }[input.connection];
    components.push({
      key: "connection",
      label: "Network connection",
      value: connection.value,
      weight: 0.1,
      detail: connection.detail,
    });
  }

  const weight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = weight
    ? Math.round(
        components.reduce((sum, component) => sum + component.value * component.weight, 0) /
          weight,
      )
    : null;
  return { score, band: relationshipBand(score), components, computedAt: now };
}
