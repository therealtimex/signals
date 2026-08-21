"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { contactDisplayInitials, uploadAndAttachContactAvatar } from "@/lib/contact-avatar-client";

type ContactAvatarUploadProps = {
  contactId: string;
  currentAvatarUrl: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  size?: "sm" | "md";
};

export function ContactAvatarUpload({
  contactId,
  currentAvatarUrl,
  name,
  firstName,
  lastName,
  size = "md",
}: ContactAvatarUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const initials = contactDisplayInitials({
    name: name ?? undefined,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
  });

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadAndAttachContactAvatar(contactId, file);
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onFileChosen(file: File | undefined) {
    if (file) void handleUpload(file);
  }

  return (
    <div className="inline-flex shrink-0 flex-col items-center gap-2">
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          onFileChosen(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "group relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium",
          size === "sm" ? "h-16 w-16 text-base" : "h-20 w-20 text-lg",
          "ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
          dragOver && "ring-2 ring-primary",
        )}
        aria-label="Change photo"
      >
        {currentAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-muted-foreground">{initials}</span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
      </button>
      <input
        ref={inputRef}
        id={`avatar-upload-${contactId}`}
        type="file"
        accept="image/*"
        disabled={uploading}
        className="sr-only"
        onChange={(event) => {
          onFileChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {uploading ? <p className="text-sm text-muted-foreground">Uploading…</p> : null}
    </div>
  );
}
