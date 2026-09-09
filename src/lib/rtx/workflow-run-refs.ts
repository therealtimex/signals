export function getRtxRefsFromRunConfig(config: string | null | undefined): {
  workspaceSlug: string | null;
  threadSlug: string | null;
} {
  try {
    const parsed = JSON.parse(config ?? "{}") as Record<string, unknown>;
    return {
      workspaceSlug:
        typeof parsed.rtxWorkspaceSlug === "string" ? parsed.rtxWorkspaceSlug : null,
      threadSlug: typeof parsed.rtxThreadSlug === "string" ? parsed.rtxThreadSlug : null,
    };
  } catch {
    return { workspaceSlug: null, threadSlug: null };
  }
}

export function getRtxRuntimeSessionIdFromRunConfig(
  config: string | null | undefined,
): string | null {
  try {
    const parsed = JSON.parse(config ?? "{}") as Record<string, unknown>;
    return typeof parsed.rtxRuntimeSessionId === "string"
      ? parsed.rtxRuntimeSessionId
      : null;
  } catch {
    return null;
  }
}
