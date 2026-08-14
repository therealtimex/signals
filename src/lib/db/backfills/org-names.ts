/** Normalize org name for dedup (trim + collapse whitespace). */
export function normalizeOrgName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Case-folded dedupe key for org names (Phase 1: exact match only). */
export function orgDedupeKey(name: string): string {
  return normalizeOrgName(name).toLowerCase();
}
