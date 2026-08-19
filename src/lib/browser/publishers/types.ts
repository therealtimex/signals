/** Publishing mode: auto (headless) or review (headed, user clicks Post). */
export type PublishMode = "auto" | "review";

/** Error codes for publish failures. */
export type PublishErrorCode =
  | "session_expired"
  | "captcha"
  | "upload_failed"
  | "wrong_account"
  | "timeout"
  | "unknown";

/** Request payload for publishing content via browser automation. */
export interface PublishRequest {
  platform: "x" | "linkedin";
  mode: PublishMode;
  text: string;
  mediaAssetIds?: string[];
  threadTexts?: string[];
  threadMediaIds?: string[][];
  contentItemId?: string;
}

/** Result from a publish attempt. */
export interface PublishResult {
  success: boolean;
  platformUrl?: string;
  platformPostId?: string;
  error?: string;
  errorCode?: PublishErrorCode;
  screenshotPath?: string;
}

/** Custom error with a structured error code for publish failures. */
export class PublishError extends Error {
  errorCode: PublishErrorCode;

  constructor(message: string, errorCode: PublishErrorCode) {
    super(message);
    this.name = "PublishError";
    this.errorCode = errorCode;
  }
}
