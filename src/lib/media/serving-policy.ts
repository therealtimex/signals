/** Content-Disposition policy for /api/media/[id] (ADR-092-4). */
export function contentDispositionForMime(mimeType: string, filename: string): string {
  const lower = mimeType.toLowerCase();
  const forceDownload =
    lower.includes("svg") ||
    lower.includes("html") ||
    lower.startsWith("text/") ||
    lower.includes("javascript") ||
    (!lower.startsWith("image/") &&
      !lower.startsWith("video/") &&
      !lower.startsWith("audio/") &&
      lower !== "application/pdf");

  if (forceDownload) {
    const safeName = filename.replace(/["\r\n]/g, "_");
    return `attachment; filename="${safeName}"`;
  }
  return "inline";
}
