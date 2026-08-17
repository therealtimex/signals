/** True for X/Twitter HTTPS content tabs (not Electron shell or devtools). */
export function isXContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "x.com" && parsed.hostname !== "twitter.com") return false;
    if (parsed.pathname.includes("cli-browser")) return false;
    return true;
  } catch {
    return false;
  }
}

export function isShellOrDevtoolsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.startsWith("devtools://") ||
    lower.startsWith("file://") ||
    lower.includes("/cli-browser/index.html")
  );
}

/** Score X content tabs so CDP attaches to the best candidate (prefer /home). */
export function scoreXContentPageUrl(url: string): number {
  if (!isXContentUrl(url) || isShellOrDevtoolsUrl(url)) return -1;
  if (url.includes("/home")) return 3;
  if (!url.includes("/login") && !url.includes("/i/flow/")) return 2;
  return 1;
}
