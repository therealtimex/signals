/** Platform identifiers for browser sessions. */
export type BrowserPlatform = "x" | "linkedin" | "facebook";

/** Serialized cookie (matches Playwright's Cookie shape). */
export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/** Stored browser session (encrypted at rest via AES-256-GCM). */
export interface BrowserSession {
  platform: BrowserPlatform;
  cookies: CookieData[];
  userAgent: string;
  viewport: { width: number; height: number };
  createdAt: number; // unix seconds
  lastValidatedAt: number; // unix seconds
  expiresAt?: number; // unix seconds (platform-specific)
}
