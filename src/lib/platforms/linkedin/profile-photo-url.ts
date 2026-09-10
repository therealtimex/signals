/** LinkedIn CDN profile photos share an asset id across shrink_* variants. */
const LINKEDIN_PHOTO_ASSET_RE =
  /\/(?:dms\/image\/(?:v\d+\/)?)([^/]+)\/profile-(?:displayphoto|framedphoto)/i;
const LINKEDIN_NAVBAR_THUMB_RE = /profile-displayphoto-shrink_(?:50_50|100_100)/i;
const LINKEDIN_PROFILE_PHOTO_RE = /profile-(?:displayphoto|framedphoto)/i;

function linkedInCdnHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "media.licdn.com" || host.endsWith(".licdn.com");
}

export function isLinkedInProfilePhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return linkedInCdnHostname(parsed.hostname) && LINKEDIN_PROFILE_PHOTO_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Navbar "Me" thumbnails are served at 50×50 or 100×100; top-card photos are larger. */
export function isLinkedInNavbarThumbnailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return linkedInCdnHostname(parsed.hostname) && LINKEDIN_NAVBAR_THUMB_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function linkedInProfilePhotoAssetId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!linkedInCdnHostname(parsed.hostname)) return null;
    const match = parsed.pathname.match(LINKEDIN_PHOTO_ASSET_RE);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function linkedInProfilePhotosCollide(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftId = left ? linkedInProfilePhotoAssetId(left) : null;
  const rightId = right ? linkedInProfilePhotoAssetId(right) : null;
  return Boolean(leftId && rightId && leftId === rightId);
}

function photoScore(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes("profile-framedphoto")) return 900;
  const dim = lower.match(/shrink_(\d+)_(\d+)/);
  if (!dim) return 150;
  return Number(dim[1]);
}

/** Prefer framed / 800 / 400 CDN photos over navbar-sized thumbs. */
export function preferLinkedInProfilePhotoUrl(urls: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = -1;
  for (const raw of urls) {
    const url = raw.trim();
    if (!isLinkedInProfilePhotoUrl(url)) continue;
    const score = photoScore(url);
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }
  return best;
}
