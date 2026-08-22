type Platform = "x" | "linkedin" | "facebook";

interface MediaConstraints {
  maxImages: number;
  maxVideos: number;
  maxImageSizeBytes: number;
  maxVideoSizeBytes: number;
  allowedImageTypes: string[];
  allowedVideoTypes: string[];
  imageSizeLabel: string;
  videoSizeLabel: string;
}

export const PLATFORM_MEDIA_CONSTRAINTS: Record<Platform, MediaConstraints> = {
  x: {
    maxImages: 4,
    maxVideos: 1,
    maxImageSizeBytes: 5 * 1024 * 1024, // 5 MB
    maxVideoSizeBytes: 512 * 1024 * 1024, // 512 MB
    allowedImageTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    allowedVideoTypes: ["video/mp4"],
    imageSizeLabel: "5 MB",
    videoSizeLabel: "512 MB",
  },
  linkedin: {
    maxImages: 9,
    maxVideos: 1,
    maxImageSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxVideoSizeBytes: 200 * 1024 * 1024, // 200 MB
    allowedImageTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    allowedVideoTypes: ["video/mp4"],
    imageSizeLabel: "10 MB",
    videoSizeLabel: "200 MB",
  },
  facebook: {
    maxImages: 10,
    maxVideos: 1,
    maxImageSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxVideoSizeBytes: 200 * 1024 * 1024, // 200 MB
    allowedImageTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    allowedVideoTypes: ["video/mp4"],
    imageSizeLabel: "10 MB",
    videoSizeLabel: "200 MB",
  },
};

export const ALL_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
];

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/** Validate a single file against platform constraints. Returns error string or null. */
export function validateMediaFile(
  file: { name: string; type: string; size: number },
  platform: Platform,
): string | null {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];

  if (isImageType(file.type)) {
    if (!constraints.allowedImageTypes.includes(file.type)) {
      return `Unsupported image type: ${file.type}. Allowed: JPEG, PNG, GIF, WebP`;
    }
    if (file.size > constraints.maxImageSizeBytes) {
      return `Image "${file.name}" exceeds ${constraints.imageSizeLabel} limit`;
    }
  } else if (isVideoType(file.type)) {
    if (!constraints.allowedVideoTypes.includes(file.type)) {
      return `Unsupported video type: ${file.type}. Allowed: MP4`;
    }
    if (file.size > constraints.maxVideoSizeBytes) {
      return `Video "${file.name}" exceeds ${constraints.videoSizeLabel} limit`;
    }
  } else {
    return `Unsupported file type: ${file.type}`;
  }

  return null;
}

/** Validate a set of media assets against platform slot limits. */
export function validateMediaSet(
  assets: Array<{ mimeType: string }>,
  platform: Platform,
): string | null {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const images = assets.filter((a) => isImageType(a.mimeType));
  const videos = assets.filter((a) => isVideoType(a.mimeType));

  // Videos and images are mutually exclusive on X
  if (platform === "x" && images.length > 0 && videos.length > 0) {
    return "X does not allow mixing images and videos in a single post";
  }

  if (images.length > constraints.maxImages) {
    const label =
      platform === "x" ? "X" : platform === "linkedin" ? "LinkedIn" : "Facebook";
    return `Maximum ${constraints.maxImages} images per post on ${label}`;
  }

  if (videos.length > constraints.maxVideos) {
    const label =
      platform === "x" ? "X" : platform === "linkedin" ? "LinkedIn" : "Facebook";
    return `Maximum ${constraints.maxVideos} video per post on ${label}`;
  }

  return null;
}

/** Get remaining media slots for a platform given current attachments. */
export function getRemainingSlots(
  platform: Platform,
  currentMedia: Array<{ mimeType: string }>,
): { images: number; videos: number } {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const currentImages = currentMedia.filter((a) => isImageType(a.mimeType)).length;
  const currentVideos = currentMedia.filter((a) => isVideoType(a.mimeType)).length;

  // On X, if there's a video, no images allowed (and vice versa)
  if (platform === "x") {
    if (currentVideos > 0) return { images: 0, videos: 0 };
    if (currentImages > 0) return { images: constraints.maxImages - currentImages, videos: 0 };
    return { images: constraints.maxImages, videos: constraints.maxVideos };
  }

  return {
    images: Math.max(0, constraints.maxImages - currentImages),
    videos: Math.max(0, constraints.maxVideos - currentVideos),
  };
}
