export const EMAIL_PATTERNS = [
  "{first}.{last}",
  "{first}{last}",
  "{f}{last}",
  "{first}_{last}",
  "{first}",
  "{f}.{last}",
  "{first}.{l}",
  "{first}{l}",
  "{last}.{first}",
  "{last}{f}",
  "{first}-{last}",
  "{last}",
] as const;

export type EmailNameParts = { first: string; last: string };

export function isValidEmailPattern(pattern: string): boolean {
  return /^(\{(first|last|f|l)\}[._-]?){1,3}$/.test(pattern) &&
    !/[._-]$/.test(pattern);
}

export function renderPattern(pattern: string, parts: EmailNameParts): string {
  if (!isValidEmailPattern(pattern)) throw new Error("Invalid email pattern");
  return pattern
    .replaceAll("{first}", parts.first)
    .replaceAll("{last}", parts.last)
    .replaceAll("{f}", parts.first[0] ?? "")
    .replaceAll("{l}", parts.last[0] ?? "");
}

export function matchPattern(localPart: string, parts: EmailNameParts): string[] {
  const normalized = localPart.trim().toLowerCase();
  return EMAIL_PATTERNS.filter((pattern) => renderPattern(pattern, parts) === normalized);
}
