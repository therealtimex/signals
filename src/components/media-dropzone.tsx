"use client";

import { useRef, useState, useCallback } from "react";
import { ImagePlus } from "lucide-react";
import { ALL_ALLOWED_TYPES, PLATFORM_MEDIA_CONSTRAINTS } from "@/lib/media/constraints";
import type { PublishPlatformTarget } from "@/lib/publish/types";

interface MediaDropzoneProps {
  platform: PublishPlatformTarget;
  currentCount: number;
  maxSlots: number;
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function MediaDropzone({
  platform,
  currentCount,
  maxSlots,
  onFilesSelected,
  disabled,
}: MediaDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const remaining = maxSlots - currentCount;
  const atCapacity = remaining <= 0;
  const constraints = PLATFORM_MEDIA_CONSTRAINTS[platform];

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || atCapacity || disabled) return;
      const files = Array.from(fileList).slice(0, remaining);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [atCapacity, disabled, remaining, onFilesSelected],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!atCapacity && !disabled) setDragActive(true);
    },
    [atCapacity, disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleClick = useCallback(() => {
    if (!atCapacity && !disabled) {
      inputRef.current?.click();
    }
  }, [atCapacity, disabled]);

  if (atCapacity) return null;

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
        dragActive
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALL_ALLOWED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
      <ImagePlus className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground text-center">
        JPEG, PNG, GIF, WebP up to {constraints.imageSizeLabel}
      </p>
      <p className="text-xs text-muted-foreground/70">
        {remaining}/{maxSlots} slots remaining
      </p>
    </div>
  );
}
