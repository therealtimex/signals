export type ContentFilterKey = "origin" | "platform";

export function getContentOriginView(currentOrigin?: string, currentStatus?: string): string {
  return currentStatus === "draft" ? "drafts" : (currentOrigin ?? "all");
}

export function updateContentListParams(
  current: URLSearchParams,
  key: ContentFilterKey,
  value: string
): URLSearchParams {
  const params = new URLSearchParams(current.toString());

  if (key === "origin") {
    if (value === "drafts") {
      params.delete("origin");
      params.set("status", "draft");
    } else {
      params.delete("status");
      if (value && value !== "all") params.set("origin", value);
      else params.delete("origin");
    }
  }

  if (key === "platform") {
    if (value && value !== "all") params.set("platform", value);
    else params.delete("platform");
  }

  params.delete("page");
  return params;
}

export function resetContentListParams(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  params.delete("origin");
  params.delete("status");
  params.delete("platform");
  params.delete("page");
  return params;
}

export function hasNonDefaultContentFilters(
  currentOrigin?: string,
  currentStatus?: string,
  currentPlatform?: string
): boolean {
  return Boolean(currentOrigin || currentStatus || (currentPlatform && currentPlatform !== "all"));
}

export function shouldActivateContentRow(key: string, targetIsRow: boolean): boolean {
  return targetIsRow && (key === "Enter" || key === " ");
}
