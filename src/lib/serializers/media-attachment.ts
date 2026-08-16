import type { MediaAsset, MediaAttachment } from "@/lib/db/types";

export type MediaAttachmentDTO = {
  id: string;
  mediaAssetId: string;
  role: string;
  sortOrder: number;
  caption: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  scope: string;
  url: string;
};

export function serializeMediaAttachment(
  attachment: MediaAttachment,
  asset: MediaAsset,
): MediaAttachmentDTO {
  return {
    id: attachment.id,
    mediaAssetId: attachment.mediaAssetId,
    role: attachment.role,
    sortOrder: attachment.sortOrder,
    caption: attachment.caption,
    filename: asset.filename,
    mimeType: asset.mimeType,
    fileSize: asset.fileSize,
    scope: asset.scope,
    url: `/api/media/${asset.id}`,
  };
}
