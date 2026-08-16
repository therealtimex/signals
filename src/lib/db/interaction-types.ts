/** Canonical interaction-type registry (contact-golden-record §2.4). */
export const INTERACTION_TYPE_GROUPS = {
  communication: [
    "meeting",
    "call",
    "message",
    "dm",
    "email",
    "reply",
    "intro",
  ],
  social: ["like", "comment", "share", "follow", "quote", "bookmark", "restack"],
  passive: ["view", "impression", "click", "open"],
  manual: ["note"],
} as const;

export type InteractionTypeCategory = keyof typeof INTERACTION_TYPE_GROUPS;

export const INTERACTION_TYPES = [
  ...INTERACTION_TYPE_GROUPS.communication,
  ...INTERACTION_TYPE_GROUPS.social,
  ...INTERACTION_TYPE_GROUPS.passive,
  ...INTERACTION_TYPE_GROUPS.manual,
] as const;

export type InteractionType = (typeof INTERACTION_TYPES)[number];

export function isInteractionType(value: string): value is InteractionType {
  return (INTERACTION_TYPES as readonly string[]).includes(value);
}

export function interactionTypeCategory(value: InteractionType): InteractionTypeCategory {
  for (const [category, types] of Object.entries(INTERACTION_TYPE_GROUPS) as [
    InteractionTypeCategory,
    readonly InteractionType[],
  ][]) {
    if ((types as readonly string[]).includes(value)) return category;
  }
  return "manual";
}

export function assertInteractionType(value: string): InteractionType {
  if (!isInteractionType(value)) {
    throw new Error(
      `Invalid interaction type: ${value}. Allowed types: ${INTERACTION_TYPES.join(", ")}`,
    );
  }
  return value;
}
