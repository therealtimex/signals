import { Linkedin, Mail, Newspaper } from "lucide-react";
import { PLATFORM_DISPLAY_NAMES, PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/db/platforms";

const markClass = {
  x: "bg-platform-x text-white dark:text-black",
  linkedin: "bg-platform-linkedin text-white",
  gmail: "bg-platform-gmail text-white",
  facebook: "bg-[#1877F2] text-white",
  substack: "bg-orange-600 text-white",
} as const;

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.995-9.14L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"
      />
    </svg>
  );
}

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v3H6v4h3v8h4v-8h3l1-4h-4V9c0-.6.4-1 1-1z"
      />
    </svg>
  );
}

function PlatformGlyph({ platform }: { platform: string }) {
  const iconClass = "size-3.5";
  switch (platform) {
    case "x":
      return <XMark className={iconClass} />;
    case "linkedin":
      return <Linkedin className={iconClass} />;
    case "gmail":
      return <Mail className={iconClass} />;
    case "facebook":
      return <FacebookMark className={iconClass} />;
    case "substack":
      return <Newspaper className={iconClass} />;
    default:
      return (
        <span className="text-[10px] font-semibold leading-none">
          {(PLATFORM_SHORT_LABELS[platform as Platform] ?? platform).slice(0, 1).toUpperCase()}
        </span>
      );
  }
}

export function PlatformMark({ platform }: { platform: string }) {
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
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        markClass[normalized as keyof typeof markClass] ?? "bg-muted text-muted-foreground",
      )}
    >
      <PlatformGlyph platform={normalized} />
    </span>
  );
}
