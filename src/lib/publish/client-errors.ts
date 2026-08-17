/** Map send-to-agent error codes to user-facing copy (§4.4). */
export function sendToAgentErrorMessage(
  errorCode: string | undefined,
  fallback: string
): string {
  switch (errorCode) {
    case "standalone":
      return "Publishing requires the RealTimeX Local App";
    case "permission_required":
      return "Grant 'Desktop Runtime Sessions' to Signals in RealTimeX → Local Apps";
    case "rtx_unavailable":
      return "RealTimeX desktop isn't running";
    case "launch_failed":
      return fallback || "Failed to launch publish agent";
    default:
      return fallback;
  }
}
