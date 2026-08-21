"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import {
  MAX_TAG_COUNT,
  normalizeTagList,
  type SliderBounds,
} from "@/lib/workflows/template-field-utils";

interface BoundedSliderProps {
  id: string;
  label: string;
  bounds: SliderBounds;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  format: (value: number) => string;
  hint?: string;
}

/** Range input for one clamped template budget. The caller re-clamps in `onChange`. */
export function BoundedSlider({
  id,
  label,
  bounds,
  value,
  onChange,
  disabled,
  format,
  hint,
}: BoundedSliderProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs font-medium tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface TagListFieldProps {
  id: string;
  label: string;
  placeholder: string;
  emptyHint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

/** Comma- or Enter-separated tag pills, normalized through the shared template rules. */
export function TagListField({
  id,
  label,
  placeholder,
  emptyHint,
  tags,
  onChange,
  disabled,
}: TagListFieldProps) {
  const [draft, setDraft] = useState("");
  const atCap = tags.length >= MAX_TAG_COUNT;

  function commitDraft() {
    if (!draft.trim()) return;
    const next = normalizeTagList([...tags, ...draft.split(",")]);
    onChange(next);
    // Keep the text when nothing was accepted (at the cap, or a duplicate) so the entry does
    // not vanish without explanation.
    if (next.length > tags.length) setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        placeholder={atCap ? `Limit of ${MAX_TAG_COUNT} reached` : placeholder}
        disabled={disabled || atCap}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Enter adds a tag here; it must not submit the surrounding dialog.
          e.preventDefault();
          commitDraft();
        }}
      />
      {atCap && (
        <p className="text-xs text-muted-foreground">
          Limit of {MAX_TAG_COUNT} reached — remove one to add another.
        </p>
      )}
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70 disabled:opacity-50"
            >
              {tag}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove {tag}</span>
            </button>
          ))}
        </div>
      ) : (
        emptyHint && <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  );
}
