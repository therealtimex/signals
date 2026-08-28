export type CompanyActionFeedback = {
  kind: "success" | "error" | "permission" | "not_embedded";
  message: string;
};

type ErrorBody = { error?: unknown; code?: unknown };

export async function companyActionError(
  response: Response,
  fallback: string,
): Promise<CompanyActionFeedback> {
  const body = await response.json().catch(() => ({})) as ErrorBody;
  const serverMessage = typeof body.error === "string" ? body.error : null;
  const code = typeof body.code === "string" ? body.code.toLowerCase() : "";
  if (response.status === 401 || response.status === 403 || code === "forbidden" || code === "permission_denied") {
    return {
      kind: "permission",
      message: serverMessage ? `Permission denied: ${serverMessage}` : "Permission denied. Check your RealTimeX workspace permissions.",
    };
  }
  if (["rtx_unavailable", "standalone", "not_embedded"].includes(code)) {
    return {
      kind: "not_embedded",
      message: serverMessage ?? "This action is available when Signals is running inside RealTimeX.",
    };
  }
  return { kind: "error", message: serverMessage ?? fallback };
}
