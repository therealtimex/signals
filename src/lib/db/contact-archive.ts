/**
 * Leaf module: the single definition of "is this contact archived".
 *
 * `archived: 1` lives in the contact metadata blob (see `archiveContact`), so every
 * reader has to parse it the same way. This lives outside the query modules so that
 * `identity-claims` can use it without importing `queries/contacts`, which would
 * close an import cycle.
 */
export function isContactArchived(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    return (JSON.parse(metadata) as { archived?: number }).archived === 1;
  } catch {
    return false;
  }
}
