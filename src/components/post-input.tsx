"use client";

import { useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, ArrowUp, ArrowDown } from "lucide-react";
import { MediaDropzone } from "@/components/media-dropzone";
import { MediaThumbnailGrid } from "@/components/media-thumbnail-grid";
import type { MediaThumbnailItem } from "@/components/media-thumbnail-grid";
import { PLATFORM_MEDIA_CONSTRAINTS, isVideoType } from "@/lib/media/constraints";

interface PostInputProps {
  value: string;
  onChange: (value: string) => void;
  index: number;
  total: number;
  showNumber: boolean;
  maxChars?: number;
  placeholder?: string;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  autoFocus?: boolean;
  media?: MediaThumbnailItem[];
  onAddMedia?: (files: File[]) => void;
  onRemoveMedia?: (id: string) => void;
  platform?: "x" | "linkedin";
}

export function PostInput({
  value,
  onChange,
  index,
  total,
  showNumber,
  maxChars = 280,
  placeholder,
  onRemove,
  onMoveUp,
  onMoveDown,
  autoFocus,
  media,
  onAddMedia,
  onRemoveMedia,
  platform,
}: PostInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const length = value.length;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 80)}px`;
  }, [value]);

  // Auto-focus when added
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const warnThreshold = Math.floor(maxChars * 0.93);
  const counterColor =
    length > maxChars
      ? "text-danger"
      : length >= warnThreshold
        ? "text-warning"
        : "text-muted-foreground";

  const defaultPlaceholder = showNumber
    ? `Post ${index + 1}...`
    : "What's happening?";

  return (
    <div className="relative group">
      {/* Post number badge */}
      {showNumber && (
        <div className="flex items-center gap-1 mb-1.5">
          <Badge variant="secondary" className="text-xs">
            {index + 1}
          </Badge>
          {/* Reorder + remove controls */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onMoveUp && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onMoveUp}
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
            )}
            {onMoveDown && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onMoveDown}
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
            )}
            {onRemove && total > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={onRemove}
                title="Remove post"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? defaultPlaceholder}
        className="resize-none min-h-[80px] pr-16"
      />

      {/* Character counter */}
      <span
        className={`absolute bottom-2 right-3 text-xs font-mono ${counterColor}`}
      >
        {length}/{maxChars}
      </span>

      {/* Media attachments */}
      {media && media.length > 0 && onRemoveMedia && (
        <div className="mt-2">
          <MediaThumbnailGrid media={media} onRemove={onRemoveMedia} />
        </div>
      )}

      {/* Media dropzone */}
      {platform && onAddMedia && (
        <div className="mt-2">
          <MediaDropzone
            platform={platform}
            currentCount={media?.length ?? 0}
            maxSlots={computeMaxSlots(platform, media ?? [])}
            onFilesSelected={onAddMedia}
          />
        </div>
      )}
    </div>
  );
}

function computeMaxSlots(
  platform: "x" | "linkedin",
  media: MediaThumbnailItem[],
): number {
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];
  const hasVideo = media.some((m) => isVideoType(m.mimeType));
  if (hasVideo) return 1; // only 1 video allowed
  return constraints.maxImages;
}
