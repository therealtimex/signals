/**
 * Alternative names a contact is known by (#571), e.g. a Luma display name "Sas P" for a
 * LinkedIn "Sasmita S". Stored as a JSON string array on contacts.aliases.
 */
export const CONTACT_ALIAS_MAX_LENGTH = 120;
export const CONTACT_ALIASES_MAX = 50;
export const CONTACT_ALIASES_PER_WRITE_MAX = 20;

export function normalizeContactAlias(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function aliasKey(value: string): string {
  return normalizeContactAlias(value).toLocaleLowerCase("en-US");
}

export function parseContactAliases(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

/**
 * Append aliases, deduped case-insensitively against the stored aliases, each other and the
 * contact's own name. The first-seen spelling wins. Returns only what changed in `added`.
 */
export function mergeContactAliases(
  existing: string[],
  incoming: string[],
  contactName: string,
): { aliases: string[]; added: string[] } {
  const seen = new Set<string>([aliasKey(contactName), ...existing.map(aliasKey)]);
  const added: string[] = [];
  for (const raw of incoming) {
    const alias = normalizeContactAlias(raw);
    const key = aliasKey(alias);
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    added.push(alias);
  }
  return { aliases: [...existing, ...added], added };
}
