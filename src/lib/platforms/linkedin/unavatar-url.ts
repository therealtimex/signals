/** LinkedIn vanity slug: letters, digits, hyphens (see linkedin.com/in/{slug}). */
const LINKEDIN_VANITY_SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,98}[a-zA-Z0-9])?$/;

/**
 * LinkedIn splits its public profiles across two unavatar namespaces. `user:` serves
 * `linkedin.com/in/{slug}` (people); `company:` serves `linkedin.com/company/{slug}` (orgs).
 * A company slug asked for under `user:` 404s, so the namespace is not optional.
 */
export type LinkedInProfileKind = "person" | "company";

export const LINKEDIN_PROFILE_KINDS: readonly LinkedInProfileKind[] = ["person", "company"];

export function isLinkedInVanitySlug(slug: string): boolean {
  const trimmed = slug.trim().replace(/^@/, "");
  return trimmed.length > 0 && LINKEDIN_VANITY_SLUG_RE.test(trimmed);
}

/** Public avatar resolver — always namespaced (never a bare `/linkedin/{slug}`, which 404s). */
export function buildLinkedInUnavatarUrl(
  slug: string,
  kind: LinkedInProfileKind = "person",
): string | undefined {
  const trimmed = slug.trim().replace(/^@/, "");
  if (!isLinkedInVanitySlug(trimmed)) return undefined;
  const namespace = kind === "company" ? "company" : "user";
  return `https://unavatar.io/linkedin/${namespace}:${encodeURIComponent(trimmed)}`;
}

/**
 * Both namespaces for a slug, person first. Nothing in the contact record marks a LinkedIn
 * identity as a company page, so the enricher probes both rather than guessing.
 */
export function buildLinkedInUnavatarCandidates(slug: string): string[] {
  return LINKEDIN_PROFILE_KINDS.map((kind) => buildLinkedInUnavatarUrl(slug, kind)).filter(
    (url): url is string => Boolean(url),
  );
}
