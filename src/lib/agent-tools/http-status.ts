import type { AgentToolErrorCode } from "@/lib/agent-tools/types";

export function agentToolErrorStatus(code: AgentToolErrorCode): number {
  if (code === "TOOL_NOT_FOUND" || code === "NOT_FOUND") return 404;
  if (
    code === "VALIDATION_ERROR"
    || code === "CAPABILITY_UNSUPPORTED"
    || code === "TARGET_REQUIRED"
  ) return 400;
  if (
    code === "CONFLICT"
    || code === "AUDIT_STALE"
    || code === "AUDIT_BLOCKED"
    || code === "APPROVAL_REQUIRED"
    || code === "STORE_CONFLICT"
  ) return 409;
  if (code === "STORE_BUSY" || code === "WORKSPACE_UNAVAILABLE") return 503;
  return 500;
}
