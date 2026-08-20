/**
 * Normalization keys for duplicate detection (#209).
 *
 * These are machine dedupe keys only — never persist them or show them to users.
 * `normalizeChannelValue` already owns email/handle normalization for storage, so
 * this module reuses it rather than inventing a second email key.
 */

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "rev"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "mba", "esq"]);

/** Strip diacritics, punctuation, honorifics, and suffixes; collapse whitespace. */
export function normalizePersonName(raw: string | null | undefined): string {
  if (!raw) return "";
  const folded = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!folded) return "";

  const tokens = folded
    .split(" ")
    .filter((token, index, all) => {
      if (index === 0 && HONORIFICS.has(token)) return false;
      if (index === all.length - 1 && all.length > 1 && SUFFIXES.has(token)) return false;
      return token.length > 0;
    });

  return tokens.join(" ");
}

/**
 * Order-insensitive name key so "Linxi Fan" and "Fan Linxi" collide.
 * Single-token names are intentionally weak keys — Tier 2 always pairs this
 * with an org match before proposing a merge.
 */
export function personNameKey(raw: string | null | undefined): string {
  const normalized = normalizePersonName(raw);
  if (!normalized) return "";
  return normalized.split(" ").sort().join(" ");
}

/** Case-folded org key. Mirrors `orgDedupeKey` but tolerates null. */
export function orgNameKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Identity claim key — matches the `idx_identity_platform_user` unique index. */
export function identityClaimKey(platform: string, platformUserId: string): string {
  return `${platform}:${platformUserId.trim().toLowerCase()}`;
}

/**
 * Token-set similarity over normalized names, 0..1.
 *
 * Deliberately not edit distance: the observed duplicates differ by token
 * presence ("Jim Fan" vs "Jim Linxi Fan"), not by typo.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = new Set(normalizePersonName(a).split(" ").filter(Boolean));
  const right = new Set(normalizePersonName(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  if (shared === 0) return 0;

  // Overlap coefficient, not Jaccard: a middle name on one side should not
  // punish an otherwise exact match down below the Tier 2 floor.
  return shared / Math.min(left.size, right.size);
}
