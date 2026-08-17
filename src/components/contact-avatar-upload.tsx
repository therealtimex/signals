"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadAndAttachContactAvatar } from "@/lib/contact-avatar-client";

type ContactAvatarUploadProps = {
  contactId: string;
  currentAvatarUrl: string | null;
};

export function ContactAvatarUpload({ contactId, currentAvatarUrl }: ContactAvatarUploadProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex items-center gap-4">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center overflow-hidden text-sm font-medium">
        {currentAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={currentAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>?</span>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`avatar-upload-${contactId}`}>Avatar</Label>
        <Input
          id={`avatar-upload-${contactId}`}
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {uploading ? <p className="text-sm text-muted-foreground">Uploading…</p> : null}
      </div>
    </div>
  );
}
