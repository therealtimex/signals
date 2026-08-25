type AvatarLoadListener = () => void;

const avatarCache = new Map<string, HTMLImageElement | "failed">();
const listeners = new Set<AvatarLoadListener>();

function notifyAvatarListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeExploreMapAvatarCache(listener: AvatarLoadListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExploreMapAvatar(url: string | null | undefined): HTMLImageElement | null {
  if (!url || typeof document === "undefined") return null;

  const cached = avatarCache.get(url);
  if (cached === "failed") return null;
  if (cached instanceof HTMLImageElement && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }

  if (!cached) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => notifyAvatarListeners();
    image.onerror = () => {
      avatarCache.set(url, "failed");
      notifyAvatarListeners();
    };
    image.src = url;
    avatarCache.set(url, image);
  }

  const loading = avatarCache.get(url);
  if (loading instanceof HTMLImageElement && loading.complete && loading.naturalWidth > 0) {
    return loading;
  }
  return null;
}

/** Test helper — not used in production paths. */
export function resetExploreMapAvatarCacheForTests() {
  avatarCache.clear();
}
