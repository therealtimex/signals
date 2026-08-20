export const PLATFORM_TARGET_ERROR_CODES = [
  "TARGET_NOT_FOUND",
  "TARGET_FORGOTTEN",
  "TARGET_CAPABILITY_UNSUPPORTED",
  "TARGET_ACTIVATION_UNSUPPORTED",
  "CONNECTION_UNAVAILABLE",
  "LOGIN_REQUIRED",
  "SESSION_LEASE_HELD",
  "LEASE_LOST",
  "TARGET_NOT_ACTIVE",
] as const;

export type PlatformTargetErrorCode = (typeof PLATFORM_TARGET_ERROR_CODES)[number];

export class PlatformTargetError extends Error {
  constructor(
    public readonly code: PlatformTargetErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PlatformTargetError";
  }
}

export function platformTargetErrorResult(error: unknown): {
  error: string;
  code: PlatformTargetErrorCode;
  details?: Record<string, unknown>;
} | null {
  if (!(error instanceof PlatformTargetError)) return null;
  return {
    error: error.message,
    code: error.code,
    ...(error.details ? { details: error.details } : {}),
  };
}
