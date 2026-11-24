/** ICP fit tiers written by score_contact_fit (#570). */
export const CONTACT_FIT_TIER_ENUM = ["A", "B", "C", "unknown"] as const;

export type ContactFitTier = (typeof CONTACT_FIT_TIER_ENUM)[number];
