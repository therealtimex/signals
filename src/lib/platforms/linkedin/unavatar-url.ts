/** LinkedIn vanity slug: letters, digits, hyphens (see linkedin.com/in/{slug}). */
const LINKEDIN_VANITY_SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,98}[a-zA-Z0-9])?$/;

export function isLinkedInVanitySlug(slug: string): boolean {
  const trimmed = slug.trim().replace(/^@/, "");
  return trimmed.length > 0 && LINKEDIN_VANITY_SLUG_RE.test(trimmed);
}

/** Public avatar resolver — use `user:` prefix (not bare `/linkedin/{slug}`). */
export function buildLinkedInUnavatarUrl(slug: string): string | undefined {
  const trimmed = slug.trim().replace(/^@/, "");
  if (!isLinkedInVanitySlug(trimmed)) return undefined;
  return `https://unavatar.io/linkedin/user:${encodeURIComponent(trimmed)}`;
}
