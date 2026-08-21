export const RELATIONSHIP_STAGES = [
  "stranger",
  "acquaintance",
  "warm",
  "close",
  "inner_circle",
] as const;

export type RelationshipStageValue = (typeof RELATIONSHIP_STAGES)[number];

const STAGE_LABELS: Record<RelationshipStageValue, string> = {
  stranger: "Stranger",
  acquaintance: "Acquaintance",
  warm: "Warm",
  close: "Close",
  inner_circle: "Inner circle",
};

export function formatRelationshipStage(stage: string): string {
  if (stage in STAGE_LABELS) {
    return STAGE_LABELS[stage as RelationshipStageValue];
  }
  return stage.replaceAll("_", " ");
}

export function formatWebsiteLabel(url: string): string {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export function hrefForWebsite(url: string): string {
  return url.includes("://") ? url : `https://${url}`;
}

export function formatLastTouch(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const INTERACTION_TYPE_LABELS: Record<string, string> = {
  dm: "DM",
};

export function formatInteractionType(type: string): string {
  if (type in INTERACTION_TYPE_LABELS) return INTERACTION_TYPE_LABELS[type];
  return type
    .split("_")
    .map((part) => INTERACTION_TYPE_LABELS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const INTERACTION_TYPE_GROUP_LABELS = {
  manual: "Notes",
  communication: "Communication",
  social: "Social",
  passive: "Passive",
} as const;

export function formatTimelineOccurredAt(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const MIME_FILE_LABELS: Record<string, string> = {
  "image/svg+xml": "SVG",
  "text/html": "HTML",
  "text/plain": "Text",
  "application/zip": "ZIP",
};

export function formatAttachmentError(message: string): string {
  const unsupported = /^Unsupported attachment type:\s*(.*)$/i.exec(message);
  if (unsupported) {
    const mime = unsupported[1].trim();
    const label =
      MIME_FILE_LABELS[mime] ??
      (mime.includes("/")
        ? mime.slice(mime.indexOf("/") + 1).replace("+xml", "").toUpperCase()
        : mime.toUpperCase());
    if (!label) {
      return "That file type isn't supported. Try a PNG, JPEG, PDF, or Office file.";
    }
    return `${label} files aren't supported. Try a PNG, JPEG, PDF, or Office file.`;
  }
  if (/^File extension does not match MIME type/i.test(message)) {
    return "That file's type doesn't match its extension.";
  }
  const tooBig = /^File "(.+)" exceeds size limit/.exec(message);
  if (tooBig) {
    return `${tooBig[1]} is too large to attach.`;
  }
  return message;
}

export function isImageMime(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType?.startsWith("image/") && mimeType !== "image/svg+xml");
}

export function isPdfAttachment(mimeType: string | null | undefined, filename?: string | null): boolean {
  return mimeType === "application/pdf" || Boolean(filename?.toLowerCase().endsWith(".pdf"));
}

export function isRedundantHeadline(
  headline: string | null | undefined,
  title?: string | null,
  company?: string | null,
): boolean {
  if (!headline?.trim()) return true;
  const normalized = headline.trim().toLowerCase().replace(/\s+/g, " ");
  const titleNorm = title?.trim().toLowerCase() ?? "";
  const companyNorm = company?.trim().toLowerCase() ?? "";
  if (titleNorm && normalized === titleNorm) return true;
  if (companyNorm && normalized === companyNorm) return true;
  if (titleNorm && companyNorm) {
    const variants = [
      `${titleNorm} at ${companyNorm}`,
      `${titleNorm}, ${companyNorm}`,
      `${titleNorm} · ${companyNorm}`,
      `${companyNorm} · ${titleNorm}`,
      `${titleNorm} @ ${companyNorm}`,
    ];
    if (variants.includes(normalized)) return true;
  }
  return false;
}

export function formatContactListSubtitle(contact: {
  headline?: string | null;
  title?: string | null;
  company?: string | null;
}): string | null {
  const headline = contact.headline?.trim() ?? "";
  if (headline && !isRedundantHeadline(headline, contact.title, contact.company)) {
    return headline;
  }
  const title = contact.title?.trim() ?? "";
  const company = contact.company?.trim() ?? "";
  if (title && company) return `${title} · ${company}`;
  return title || company || null;
}
