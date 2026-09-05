/**
 * Row-rendering helpers for the Companies list. They live outside the component file so the
 * component module exports only components, and so they can be tested without a renderer.
 */

/** Initials for the logo placeholder — the same treatment contacts get, so rows read as rows. */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

/** "3 people · Ada Lovelace, Alan Turing +1" — the org-side mirror of a contact's employment line. */
export function peopleSummary(count: number, names: string[]): string {
  if (count === 0) return "No linked people";
  const label = count === 1 ? "1 person" : `${count} people`;
  if (names.length === 0) return label;
  const shown = names.slice(0, 2);
  const extra = count - shown.length;
  return extra > 0
    ? `${label} · ${shown.join(", ")} +${extra}`
    : `${label} · ${shown.join(", ")}`;
}
