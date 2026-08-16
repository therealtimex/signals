import { extname } from "path";

export type UploadContext = "compose" | "attachment";

const ATTACHMENT_MIME_LIMITS: Record<string, number> = {
  image: 25 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  application: 100 * 1024 * 1024,
};

const ATTACHMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/ogg",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MIME_EXTENSION_HINTS: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/webm": [".webm"],
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a"],
  "audio/m4a": [".m4a"],
  "audio/wav": [".wav"],
  "audio/ogg": [".ogg"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

function sizeLimitForMime(mimeType: string): number {
  const category = mimeType.split("/")[0] ?? "application";
  return ATTACHMENT_MIME_LIMITS[category] ?? ATTACHMENT_MIME_LIMITS.application;
}

function extensionMatchesMime(fileName: string, mimeType: string): boolean {
  const ext = extname(fileName).toLowerCase();
  const hints = MIME_EXTENSION_HINTS[mimeType];
  if (!hints || hints.length === 0) return true;
  return hints.includes(ext);
}

/** Validate general attachment uploads (ADR-092-4). */
export function validateAttachmentFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!ATTACHMENT_ALLOWED_TYPES.has(file.type)) {
    return `Unsupported attachment type: ${file.type}`;
  }
  if (!extensionMatchesMime(file.name, file.type)) {
    return `File extension does not match MIME type ${file.type}`;
  }
  const limit = sizeLimitForMime(file.type);
  if (file.size > limit) {
    return `File "${file.name}" exceeds size limit for ${file.type}`;
  }
  return null;
}
