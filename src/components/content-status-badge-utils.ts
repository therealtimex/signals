export type ContentStatusTone = "neutral" | "info" | "success" | "danger";
export type ContentStatusIcon = "clock" | "loader" | "alert";

export interface ContentStatusPresentation {
  tone: ContentStatusTone;
  label: string;
  icon?: ContentStatusIcon;
}

export function getContentStatusPresentation(
  status: string | null | undefined,
  options: { activeView?: string } = {}
): ContentStatusPresentation | null {
  const resolvedStatus = status ?? "draft";
  if (resolvedStatus === "draft" && options.activeView === "drafts") return null;

  const presentations: Record<string, ContentStatusPresentation> = {
    draft: { tone: "neutral", label: "Draft" },
    queued: { tone: "neutral", label: "Queued", icon: "clock" },
    publishing: { tone: "info", label: "Publishing", icon: "loader" },
    published: { tone: "success", label: "Published" },
    imported: { tone: "neutral", label: "Imported" },
    failed: { tone: "danger", label: "Failed", icon: "alert" },
  };

  return presentations[resolvedStatus] ?? null;
}
