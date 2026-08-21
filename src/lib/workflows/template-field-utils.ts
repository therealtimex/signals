/**
 * Field primitives shared by the config-driven workflow templates (Social Intent Patrol,
 * Profile Publishing & Repost).
 *
 * Each template owns its own config shape, but they all read the same operator input: bounded
 * sliders, tag pills, and id multi-selects. Keeping the normalizers here is what lets a template's
 * dialog, its stored config, and its launch brief agree on what a value means.
 */

/** Cap on free-text tag lists (communities, intent keywords, topics) per template config. */
export const MAX_TAG_COUNT = 20;

export interface SliderBounds {
  min: number;
  max: number;
  step: number;
  fallback: number;
}

/** Snap to the slider's step grid, then clamp into range. */
export function clampSlider(bounds: SliderBounds, value: unknown): number {
  const { min, max, step, fallback } = bounds;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return fallback;
  const snapped = min + Math.round((numeric - min) / step) * step;
  return Math.min(Math.max(snapped, min), max);
}

/** Trim, drop blanks, de-duplicate case-insensitively, and cap the list length. */
export function normalizeTagList(value: unknown, max = MAX_TAG_COUNT): string[] {
  return normalizeStringList(value, max, (tag) => tag.toLowerCase());
}

/**
 * Same shape as `normalizeTagList`, but de-duplicates on the exact string.
 *
 * Record ids are opaque and case-sensitive, so folding case here could silently drop a distinct
 * selection instead of a real duplicate.
 */
export function normalizeIdList(value: unknown, max: number): string[] {
  return normalizeStringList(value, max, (id) => id);
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeStringList(
  value: unknown,
  max: number,
  dedupeKey: (entry: string) => string,
): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const entry = candidate.trim();
    if (!entry) continue;
    const key = dedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= max) break;
  }
  return entries;
}
