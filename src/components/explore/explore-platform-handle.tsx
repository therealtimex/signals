import { formatPlatformHandle } from "@/lib/contact-identity-handle";

type ExplorePlatformHandleProps = {
  platform: string;
  handle: string;
  platformUrl: string | null;
  className?: string;
};

export function ExplorePlatformHandle({
  platform,
  handle,
  platformUrl,
  className = "text-xs text-muted-foreground",
}: ExplorePlatformHandleProps) {
  const text = formatPlatformHandle(platform, handle);
  if (platformUrl) {
    return (
      <a
        href={platformUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`hover:underline ${className}`}
      >
        {text}
      </a>
    );
  }
  return <span className={className}>{text}</span>;
}
