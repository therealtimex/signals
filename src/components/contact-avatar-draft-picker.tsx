"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { contactDisplayInitials } from "@/lib/contact-avatar-client";

type ContactAvatarDraftPickerProps = {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  onFileChange: (file: File | null) => void;
};

export function ContactAvatarDraftPicker({
  displayName,
  firstName,
  lastName,
  onFileChange,
}: ContactAvatarDraftPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleFileSelected(file: File | null) {
    onFileChange(file);
    setPreviewUrl((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return file ? URL.createObjectURL(file) : null;
    });
  }

  const initials = contactDisplayInitials({ name: displayName, firstName, lastName });

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => inputRef.current?.click()}
        aria-label="Choose contact photo"
      >
        <Avatar className="size-20 text-lg">
          {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Camera className="size-5 text-white" />
        </span>
      </button>
      <div className="space-y-1">
        <Label htmlFor={inputId}>Photo</Label>
        <p className="text-sm text-muted-foreground">
          Optional. Upload a profile photo for this contact.
        </p>
        {previewUrl ? (
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              handleFileSelected(null);
              if (inputRef.current) {
                inputRef.current.value = "";
              }
            }}
          >
            Remove photo
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          handleFileSelected(file);
        }}
      />
    </div>
  );
}
