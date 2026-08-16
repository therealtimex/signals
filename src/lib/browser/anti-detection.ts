/** Common desktop viewports to rotate through per-session. */
export const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
] as const;

/** Pick a random viewport from the pool. */
export function randomViewport(): { width: number; height: number } {
  return { ...VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)] };
}

/** Sleep for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
