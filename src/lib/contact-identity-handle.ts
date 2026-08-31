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

function isLikelyAvatarUrl(url: string): boolean {
  return /pbs\.twimg\.com|media\.licdn\.com|avatars\.githubusercontent\.com|\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url);
}

function storedHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (isLikelyAvatarUrl(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("mailto:")) return trimmed;
  return null;
}

function linkedInHref(handle: string): string | null {
  if (/^https?:\/\//i.test(handle)) {
    try {
      const url = new URL(handle);
      const host = url.hostname.toLowerCase();
      return (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
        /^\/in\/[A-Za-z0-9][A-Za-z0-9_-]*\/?$/.test(url.pathname)
        ? handle
        : null;
    } catch {
      return null;
    }
  }
  const vanity = handle.replace(/^\/?(in\/)?/i, "").replace(/\/$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(vanity)) return null;
  return `https://www.linkedin.com/in/${vanity}`;
}

/** Public profile URL: stored `platformUrl` first, otherwise a canonical URL from the handle. */
export function identityProfileHref(identity: {
  platform: string;
  platformHandle?: string | null;
  platformUrl?: string | null;
}): string | null {
  const stored = storedHttpUrl(identity.platformUrl);
  if (stored) return stored;

  const handle = identity.platformHandle
    ? normalizePlatformHandle(identity.platform, identity.platformHandle)
    : "";
  if (!handle) return null;

  switch (identity.platform) {
    case "x":
      return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : null;
    case "linkedin":
      return linkedInHref(handle);
    case "gmail":
      return handle.includes("@") ? `mailto:${handle}` : null;
    case "substack":
      if (handle.includes(".")) return `https://${handle.replace(/^https?:\/\//, "")}`;
      return `https://substack.com/@${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle.replace(/^@/, "")}`;
    case "facebook":
      return `https://www.facebook.com/${handle}`;
    case "threads":
      return `https://www.threads.net/@${handle.replace(/^@/, "")}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle.replace(/^@/, "")}`;
    case "youtube":
      return `https://www.youtube.com/@${handle.replace(/^@/, "")}`;
    case "bluesky":
      return `https://bsky.app/profile/${handle.replace(/^@/, "")}`;
    case "telegram":
      return `https://t.me/${handle.replace(/^@/, "")}`;
    case "whatsapp": {
      const digits = handle.replace(/\D/g, "");
      return digits.length >= 8 ? `https://wa.me/${digits}` : null;
    }
    default:
      return null;
  }
}
