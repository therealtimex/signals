"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      const formData = new FormData();
      formData.append("file", file);
      formData.append("context", "attachment");
      const uploadRes = await fetch("/api/media", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => null);
        throw new Error(body?.error ?? "Upload failed");
      }
      const asset = (await uploadRes.json()) as { id: string };

      const attachRes = await fetch("/api/media/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaAssetId: asset.id,
          parentType: "contact",
          parentId: contactId,
          role: "avatar",
        }),
      });
      if (!attachRes.ok) {
        const body = await attachRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to attach avatar");
      }

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
