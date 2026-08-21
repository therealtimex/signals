import { formatPlatformHandle, identityProfileHref } from "@/lib/contact-identity-handle";

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
  const href = identityProfileHref({ platform, platformHandle: handle, platformUrl });
  if (href) {
    return (
      <a
        href={href}
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
