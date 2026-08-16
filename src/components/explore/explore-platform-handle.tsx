import { formatPlatformHandle } from "@/components/explore/explore-format";

type ExplorePlatformHandleProps = {
  handle: string;
  platformUrl: string | null;
  className?: string;
};

export function ExplorePlatformHandle({
  handle,
  platformUrl,
  className = "text-xs text-muted-foreground",
}: ExplorePlatformHandleProps) {
  const text = formatPlatformHandle(handle);
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
