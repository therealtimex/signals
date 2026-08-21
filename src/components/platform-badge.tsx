import { Badge } from "@/components/ui/badge";
import { PLATFORM_SHORT_LABELS } from "@/lib/platforms/capabilities";
import { cn } from "@/lib/utils";

interface PlatformBadgeProps {
  platform: string | null | undefined;
}

const platformDotStyles: Record<string, string> = {
  x: "bg-platform-x",
  linkedin: "bg-platform-linkedin",
  gmail: "bg-platform-gmail",
  facebook: "bg-[#1877F2]",
  instagram: "bg-[#E4405F]",
  threads: "bg-neutral-900",
  tiktok: "bg-neutral-950",
  youtube: "bg-[#FF0000]",
  bluesky: "bg-[#1185FE]",
  telegram: "bg-[#26A5E4]",
  whatsapp: "bg-[#25D366]",
  substack: "bg-orange-600",
};

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const normalized = platform?.toLowerCase();
  const label = normalized
    ? PLATFORM_SHORT_LABELS[normalized as keyof typeof PLATFORM_SHORT_LABELS] ?? normalized
    : "Unknown";

  return (
    <Badge variant="neutral" className={cn(!normalized && "opacity-70")}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-muted-foreground", normalized && platformDotStyles[normalized])} />
      {label}
    </Badge>
  );
}
