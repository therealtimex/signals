/** Normalize user-entered organization website values to absolute http(s) URLs. */
export function normalizeOrgWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Invalid website URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid website URL");
  }

  return url.toString();
}
