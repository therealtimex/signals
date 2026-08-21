/**
 * `contact_identities.platform_handle` stores the **canonical bare identifier** for every
 * platform: an X username, a LinkedIn vanity name, a Gmail address. The leading `@` on an X
 * handle is presentation, not data, so it is added at render time rather than persisted.
 *
 * Rows written before this convention was enforced can still carry a stored sigil, so the
 * helpers below stay tolerant of it.
 */

/** Strip a stored sigil so lookups, dedupe keys, and profile URLs get the bare identifier. */
export function normalizePlatformHandle(platform: string, handle: string): string {
  const trimmed = handle.trim();
  return platform === "x" ? trimmed.replace(/^@+/, "") : trimmed;
}

/**
 * Render a handle the way its platform writes it. Only X uses the `@` sigil — prefixing a
 * Gmail address or a LinkedIn vanity name with one is meaningless.
 */
export function formatPlatformHandle(platform: string, handle: string): string {
  const bare = normalizePlatformHandle(platform, handle);
  if (!bare) return "";
  return platform === "x" ? `@${bare}` : bare;
}
