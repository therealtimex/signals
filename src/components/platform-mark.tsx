import { Linkedin, Mail, Newspaper } from "lucide-react";
import { PLATFORM_DISPLAY_NAMES, PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/db/platforms";

const markClass: Record<string, string> = {
  x: "bg-platform-x text-white dark:text-black",
  linkedin: "bg-platform-linkedin text-white",
  gmail: "bg-platform-gmail text-white",
  facebook: "bg-[#1877F2] text-white",
  substack: "bg-orange-600 text-white",
  instagram: "bg-[#E4405F] text-white",
  threads: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-black",
  tiktok: "bg-neutral-950 text-white",
  youtube: "bg-[#FF0000] text-white",
  bluesky: "bg-[#1185FE] text-white",
  telegram: "bg-[#26A5E4] text-white",
  whatsapp: "bg-[#25D366] text-white",
};

function BrandMark({
  className,
  path,
}: {
  className?: string;
  path: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d={path} />
    </svg>
  );
}

const GLYPH_PATHS: Record<string, string> = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.995-9.14L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z",
  facebook:
    "M14 8h3V4h-3c-2.8 0-5 2.2-5 5v3H6v4h3v8h4v-8h3l1-4h-4V9c0-.6.4-1 1-1z",
  instagram:
    "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849s-.012 3.584-.069 4.849c-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849s.013-3.583.07-4.849c.149-3.227 1.664-4.771 4.919-4.919C8.333 2.175 8.741 2.163 12 2.163zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z",
  threads:
    "M16.3 11.2c-.1-2.4-1.5-4-3.9-4.1-1.4 0-2.6.6-3.3 1.6l1.2.8c.5-.7 1.2-1 2.1-1 1.5.1 2.4 1 2.5 2.6-1-.5-2.1-.6-3.2-.4-1.8.4-3 1.7-2.8 3.5.2 1.3 1.2 2.2 2.7 2.3 1.1.1 2.1-.3 2.8-1.1.5.7.8 1.2 1 1.4l1.1-.8c-.1-.2-.5-.8-1-.1.6-1 .9-2.1.8-3.7zm-3.6 3.3c-.8 0-1.4-.4-1.4-1.1 0-1 .8-1.5 2.2-1.2.6.1 1.1.4 1.5.7-.2 1.1-1.1 1.6-2.3 1.6z",
  tiktok:
    "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.9-2.88 2.89 2.89 0 0 1 2.89-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.16 15.3 6.34 6.34 0 0 0 9.5 21.64a6.34 6.34 0 0 0 6.33-6.34V8.72a8.18 8.18 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z",
  youtube:
    "M23.5 6.19A3.02 3.02 0 0 0 21.38 4.05C19.51 3.55 12 3.55 12 3.55s-7.51 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.51 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z",
  bluesky:
    "M6.3 3.5c3.5 2.6 5.2 6.4 5.7 8.8.5-2.4 2.2-6.2 5.7-8.8C19.7 2.2 22 3.4 22 6.3 22 12 16.6 16.4 12 21.4 7.4 16.4 2 12 2 6.3 2 3.4 4.3 2.2 6.3 3.5z",
  telegram:
    "M11.94 0A12 12 0 1 0 12 24 12 12 0 0 0 11.94 0zm4.96 7.22c.1 0 .32.02.47.14.14.1.18.25.2.33.02.1.04.23.02.33-.08.5-1.05 6.23-1.85 8.51-.17.55-.5.73-.82.75-.7.03-1.22-.46-1.89-.9-1.06-.7-1.66-1.13-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23 0-.03.01-.15-.06-.21-.07-.07-.17-.04-.25-.02-.1.02-1.79 1.14-5.06 3.34-.48.33-.91.49-1.3.48-.43 0-1.25-.24-1.87-.44-.75-.24-1.35-.37-1.3-.79.03-.22.33-.44.9-.66 3.5-1.53 5.83-2.53 7-3.02 3.33-1.38 4.02-1.62 4.47-1.63z",
  whatsapp:
    "M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26C2.16 5.34 6.6.9 12.05.9a9.82 9.82 0 0 1 6.99 2.9 9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.44 9.89-9.88 9.89m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.9a11.82 11.82 0 0 0-3.48-8.41z",
};

function PlatformGlyph({ platform, size }: { platform: string; size: "sm" | "md" }) {
  const iconClass = size === "sm" ? "size-3" : "size-3.5";
  switch (platform) {
    case "linkedin":
      return <Linkedin className={iconClass} />;
    case "gmail":
      return <Mail className={iconClass} />;
    case "substack":
      return <Newspaper className={iconClass} />;
    default: {
      const path = GLYPH_PATHS[platform];
      if (path) return <BrandMark className={iconClass} path={path} />;
      return (
        <span className="text-[10px] font-semibold leading-none">
          {(PLATFORM_SHORT_LABELS[platform as Platform] ?? platform).slice(0, 1).toUpperCase()}
        </span>
      );
    }
  }
}

export function PlatformMark({
  platform,
  size = "md",
}: {
  platform: string;
  size?: "sm" | "md";
}) {
  const normalized = platform.toLowerCase();
  const label =
    PLATFORM_DISPLAY_NAMES[normalized as Platform] ??
    PLATFORM_SHORT_LABELS[normalized as Platform] ??
    platform;

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" ? "size-5 rounded" : "size-7 rounded-md",
        markClass[normalized] ?? "bg-muted text-muted-foreground",
      )}
    >
      <PlatformGlyph platform={normalized} size={size} />
    </span>
  );
}
